const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');
const path = require('path');
const { setupWhatsAppClient } = require('./whatsapp-client');
const { handleClientMessage } = require('./status-manager');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected clients
const clients = new Map();
const whatsappClients = new Map();

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  // Extract client ID and session ID from query parameters
  const url = new URL(req.url, `http://${req.headers.host}`);
  const clientId = url.searchParams.get('client_id');
  const sessionId = url.searchParams.get('session_id');
  
  if (!clientId) {
    ws.close(4000, 'Missing client ID');
    return;
  }
  
  console.log(`New client connected: ${clientId}, session: ${sessionId || 'new'}`);
  
  // Store client connection
  clients.set(clientId, { 
    ws, 
    sessionId,
    isConnected: false,
    lastActivity: Date.now() 
  });
  
  // If session ID provided, try to reconnect existing session
  if (sessionId && whatsappClients.has(sessionId)) {
    console.log(`Reconnecting existing session: ${sessionId}`);
    clients.get(clientId).isConnected = true;
    
    // Notify client of successful connection
    ws.send(JSON.stringify({
      type: 'connection_success',
      session_id: sessionId
    }));
  } else {
    // Create new WhatsApp client instance
    const whatsappClient = setupWhatsAppClient(clientId, ws);
    
    // Generate new session ID
    const newSessionId = uuidv4();
    whatsappClients.set(newSessionId, whatsappClient);
    
    if (clients.has(clientId)) {
      clients.get(clientId).sessionId = newSessionId;
    }
  }
  
  // Handle incoming messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const client = clients.get(clientId);
      
      // Update last activity timestamp
      if (client) {
        client.lastActivity = Date.now();
      }
      
      // Handle client message
      handleClientMessage(clientId, data, ws, clients, whatsappClients);
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
    // Just mark the WebSocket as closed
    if (clients.has(clientId)) {
      clients.get(clientId).ws = null;
    }
  });
});

// Clean up inactive clients periodically
setInterval(() => {
  const now = Date.now();
  const inactiveTimeout = 1000 * 60 * 60; // 1 hour
  
  clients.forEach((client, clientId) => {
    if (!client.ws && (now - client.lastActivity > inactiveTimeout)) {
      console.log(`Removing inactive client: ${clientId}`);
      clients.delete(clientId);
      
      // Also clean up WhatsApp client if this was the last client using it
      if (client.sessionId && whatsappClients.has(client.sessionId)) {
        const sessionInUse = Array.from(clients.values()).some(
          c => c.sessionId === client.sessionId && c.ws
        );
        
        if (!sessionInUse) {
          console.log(`Cleaning up WhatsApp client for session: ${client.sessionId}`);
          const whatsappClient = whatsappClients.get(client.sessionId);
          if (whatsappClient && whatsappClient.destroy) {
            whatsappClient.destroy();
          }
          whatsappClients.delete(client.sessionId);
        }
      }
    }
  });
}, 1000 * 60 * 15); // Check every 15 minutes

// REST API routes for health checks and metrics
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    clients: clients.size,
    whatsappClients: whatsappClients.size
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
