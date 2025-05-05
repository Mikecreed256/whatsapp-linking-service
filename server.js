const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { makeWASocket, useMultiFileAuthState, Browsers, DisconnectReason } = require('baileys');
const qrcode = require('qrcode');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const NodeCache = require('node-cache');
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Cache for group metadata
const groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false });

// Store for active connections
const clients = new Map();
const sessions = new Map();

// Sessions directory
const SESSION_DIR = './auth_sessions';
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// Helper to start a WhatsApp session
async function startWhatsAppSession(sessionId, sendQrToClient) {
  try {
    const sessionFolder = path.join(SESSION_DIR, sessionId);
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    
    // Configuration for socket
    const socket = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      browser: Browsers.ubuntu('WhatsApp Status Viewer'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      getMessage: async (key) => {
        // Implement message retrieval if needed
        return { conversation: '' };
      },
      cachedGroupMetadata: async (jid) => {
        return groupCache.get(jid);
      }
    });
    
    // Handle connection update
    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        // Generate QR code as data URL
        try {
          const qrImage = await qrcode.toDataURL(qr);
          sendQrToClient(qrImage, 'generated');
        } catch (error) {
          console.error('QR generation error:', error);
        }
      }
      
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error instanceof Boom && 
          lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut);
        
        console.log(`Connection closed due to ${lastDisconnect?.error?.message || 'unknown reason'}`);
        
        // Reconnect if not logged out
        if (shouldReconnect) {
          console.log('Reconnecting...');
          sessions.delete(sessionId);
          await startWhatsAppSession(sessionId, sendQrToClient);
        } else {
          console.log('Connection closed. Logged out.');
          sendQrToClient(null, 'disconnected', 'Logged out from WhatsApp');
          // Clean up session
          sessions.delete(sessionId);
        }
      } else if (connection === 'open') {
        console.log('Connection opened');
        sendQrToClient(null, 'connected', 'Connected to WhatsApp');
      }
    });
    
    // Save credentials when updated
    socket.ev.on('creds.update', saveCreds);
    
    // Handle new messages
    socket.ev.on('messages.upsert', async (m) => {
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          if (msg.message && msg.key.remoteJid === 'status@broadcast') {
            // This is a status update
            const statusContent = await processStatusMessage(socket, msg);
            const client = clients.get(sessionId);
            
            if (client?.ws && client.ws.readyState === WebSocket.OPEN) {
              client.ws.send(JSON.stringify({
                type: 'status_update',
                statuses: [statusContent]
              }));
            }
          }
        }
      }
    });
    
    // Handle group updates for cache
    socket.ev.on('groups.update', async (events) => {
      for (const event of events) {
        if (event.id) {
          const metadata = await socket.groupMetadata(event.id);
          groupCache.set(event.id, metadata);
        }
      }
    });
    
    // Handle group participant updates
    socket.ev.on('group-participants.update', async (event) => {
      if (event.id) {
        const metadata = await socket.groupMetadata(event.id);
        groupCache.set(event.id, metadata);
      }
    });
    
    // Store socket in sessions map
    sessions.set(sessionId, { socket, startTime: Date.now() });
    
    return socket;
  } catch (error) {
    console.error('Error starting WhatsApp session:', error);
    sendQrToClient(null, 'error', `Error starting session: ${error.message}`);
    throw error;
  }
}

// Process a status message to extract relevant information
async function processStatusMessage(socket, msg) {
  try {
    const sender = msg.key.participant || msg.key.remoteJid || '';
    const senderName = sender.split('@')[0];
    
    // Determine message type
    let isVideo = false;
    let messageContent = '';
    let mediaUrl = '';
    let thumbnailUrl = '';
    
    if (msg.message.imageMessage) {
      messageContent = msg.message.imageMessage.caption || '';
      try {
        const media = await socket.downloadMediaMessage(msg);
        mediaUrl = `data:${msg.message.imageMessage.mimetype};base64,${media.toString('base64')}`;
        thumbnailUrl = mediaUrl;
      } catch (err) {
        console.error('Error downloading image:', err);
      }
    } else if (msg.message.videoMessage) {
      isVideo = true;
      messageContent = msg.message.videoMessage.caption || '';
      try {
        const media = await socket.downloadMediaMessage(msg);
        mediaUrl = `data:${msg.message.videoMessage.mimetype};base64,${media.toString('base64')}`;
        // Use thumbnail if available, otherwise use blank
        if (msg.message.videoMessage.jpegThumbnail) {
          thumbnailUrl = `data:image/jpeg;base64,${msg.message.videoMessage.jpegThumbnail.toString('base64')}`;
        } else {
          thumbnailUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        }
      } catch (err) {
        console.error('Error downloading video:', err);
      }
    } else if (msg.message.conversation) {
      messageContent = msg.message.conversation;
    }
    
    // Get sender contact info
    let author = 'Unknown';
    try {
      const contactInfo = await socket.getContactInfo(sender);
      author = contactInfo?.name || contactInfo?.verifiedName || senderName;
    } catch (err) {
      console.error('Error getting contact info:', err);
      author = senderName;
    }
    
    return {
      id: msg.key.id,
      timestamp: msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000) : new Date(),
      is_video: isVideo,
      thumbnail_url: thumbnailUrl,
      media_url: mediaUrl,
      author: author,
      content: messageContent
    };
  } catch (error) {
    console.error('Error processing status message:', error);
    return {
      id: msg.key?.id || uuidv4(),
      timestamp: new Date(),
      is_video: false,
      thumbnail_url: '',
      media_url: '',
      author: 'Unknown',
      content: 'Error processing status'
    };
  }
}

// Handle WebSocket connection
wss.on('connection', (ws, req) => {
  // Parse URL parameters
  const url = new URL(req.url, `http://${req.headers.host}`);
  const clientId = url.searchParams.get('client_id') || uuidv4();
  const existingSessionId = url.searchParams.get('session_id');
  
  console.log(`New client connected: ${clientId}, session: ${existingSessionId || 'new'}`);
  
  // Store client connection
  clients.set(clientId, { 
    ws, 
    sessionId: existingSessionId,
    lastActivity: Date.now() 
  });
  
  // Function to send QR code to client
  const sendQrToClient = (qrImage, status, message = '') => {
    const client = clients.get(clientId);
    if (client?.ws && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({
        type: 'qr_code_status',
        status,
        data: qrImage,
        message
      }));
    }
  };
  
  // If session ID provided, try to reconnect existing session
  if (existingSessionId && sessions.has(existingSessionId)) {
    console.log(`Reconnecting existing session: ${existingSessionId}`);
    
    // Update client with session ID
    const client = clients.get(clientId);
    if (client) {
      client.sessionId = existingSessionId;
    }
    
    // Notify client of successful connection
    ws.send(JSON.stringify({
      type: 'connection_success',
      session_id: existingSessionId,
      message: 'Reconnected to existing session'
    }));
    
    // Fetch and send current statuses
    const sessionData = sessions.get(existingSessionId);
    fetchCurrentStatuses(sessionData.socket, clientId);
    
  } else {
    // Create new session
    const sessionId = existingSessionId || uuidv4();
    
    // Update client with session ID
    const client = clients.get(clientId);
    if (client) {
      client.sessionId = sessionId;
    }
    
    // Start new WhatsApp session
    startWhatsAppSession(sessionId, sendQrToClient)
      .then(() => {
        console.log(`Started new session: ${sessionId}`);
      })
      .catch(err => {
        console.error(`Failed to start session: ${err.message}`);
      });
  }
  
  // Handle incoming messages
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      const client = clients.get(clientId);
      
      // Update last activity timestamp
      if (client) {
        client.lastActivity = Date.now();
      }
      
      // Handle client message
      handleClientMessage(clientId, data, ws);
    } catch (err) {
      console.error(`Error handling message: ${err.message}`);
      ws.send(JSON.stringify({
        type: 'error',
        code: 'MESSAGE_ERROR',
        message: `Error processing message: ${err.message}`
      }));
    }
  });
  
  // Handle disconnection
  ws.on('close', () => {
    console.log(`Client disconnected: ${clientId}`);
    // Don't remove the client right away to allow reconnection
    if (clients.has(clientId)) {
      const client = clients.get(clientId);
      client.ws = null;
    }
  });
});

// Handle client messages
async function handleClientMessage(clientId, data, ws) {
  const { type } = data;
  const client = clients.get(clientId);
  
  if (!client) {
    console.error(`Client not found: ${clientId}`);
    return;
  }
  
  const sessionId = client.sessionId;
  const sessionData = sessionId ? sessions.get(sessionId) : null;
  const socket = sessionData?.socket;
  
  switch (type) {
    case 'heartbeat':
      // Just update last activity timestamp
      break;
      
    case 'request_status_updates':
      console.log(`Status updates requested by client: ${clientId}`);
      if (socket) {
        await fetchCurrentStatuses(socket, clientId);
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'NO_SESSION',
          message: 'No active WhatsApp session'
        }));
      }
      break;
      
    case 'request_media':
      const { status_id } = data;
      console.log(`Media requested for status: ${status_id} by client: ${clientId}`);
      
      if (socket) {
        try {
          // This is a placeholder - in a full implementation, you would
          // fetch the media for the specific status ID from WhatsApp
          ws.send(JSON.stringify({
            type: 'error',
            code: 'NOT_IMPLEMENTED',
            message: 'Individual media requests not yet implemented'
          }));
        } catch (err) {
          console.error(`Error fetching media: ${err.message}`);
          ws.send(JSON.stringify({
            type: 'error',
            code: 'MEDIA_ERROR',
            message: `Error fetching media: ${err.message}`
          }));
        }
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'NO_SESSION',
          message: 'No active WhatsApp session'
        }));
      }
      break;
      
    case 'disconnect':
      console.log(`Disconnect requested by client: ${clientId}`);
      if (socket) {
        await socket.logout();
        socket.end(undefined);
        sessions.delete(sessionId);
        
        ws.send(JSON.stringify({
          type: 'disconnected',
          message: 'Logged out from WhatsApp'
        }));
      }
      break;
  }
}

// Fetch current status updates
async function fetchCurrentStatuses(socket, clientId) {
  try {
    // In a full implementation, you would fetch recent statuses
    // This is a placeholder showing the approach
    const client = clients.get(clientId);
    
    if (client?.ws && client.ws.readyState === WebSocket.OPEN) {
      // Send a message indicating we're fetching statuses
      client.ws.send(JSON.stringify({
        type: 'status_fetch_start',
        message: 'Fetching recent statuses...'
      }));
      
      // In a real implementation, you would:
      // 1. Get the status broadcast list
      // 2. Fetch recent status messages
      // 3. Process and send them to the client
      
      // For now, we'll just send a message that statuses are not available this way
      client.ws.send(JSON.stringify({
        type: 'info',
        message: 'Status updates will appear here when contacts post new statuses'
      }));
    }
  } catch (error) {
    console.error('Error fetching statuses:', error);
    const client = clients.get(clientId);
    if (client?.ws && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({
        type: 'error',
        code: 'STATUS_FETCH_ERROR',
        message: `Error fetching statuses: ${error.message}`
      }));
    }
  }
}

// Clean up inactive clients periodically
setInterval(() => {
  const now = Date.now();
  const inactiveTimeout = 1000 * 60 * 60; // 1 hour
  
  clients.forEach((client, clientId) => {
    if (!client.ws && (now - client.lastActivity > inactiveTimeout)) {
      console.log(`Removing inactive client: ${clientId}`);
      clients.delete(clientId);
    }
  });
}, 1000 * 60 * 15); // Check every 15 minutes

// API routes

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    clients: clients.size,
    sessions: sessions.size
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
