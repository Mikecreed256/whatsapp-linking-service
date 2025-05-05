const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');

// Setup WhatsApp client
function setupWhatsAppClient(clientId, ws) {
  console.log(`Setting up WhatsApp client for: ${clientId}`);
  
  // Create new WhatsApp client
  const client = new Client({
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    }
  });
  
  // Handle QR code
  client.on('qr', (qr) => {
    console.log(`QR code generated for client: ${clientId}`);
    
    // Generate and send QR code to client
    qrcode.toDataURL(qr, (err, url) => {
      if (err) {
        console.error(`Error generating QR code: ${err.message}`);
        return;
      }
      
      // Extract just the base64 data (remove the prefix)
      const qrData = url.replace(/^data:image\/png;base64,/, '');
      
      // Send QR code to client
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'qr_code_status',
          status: 'generated',
          data: qrData
        }));
      }
    });
  });
  
  // Handle authentication success
  client.on('authenticated', (session) => {
    console.log(`Client authenticated: ${clientId}`);
    
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({
        type: 'qr_code_status',
        status: 'authenticated',
        message: 'WhatsApp authenticated successfully'
      }));
    }
  });
  
  // Handle authentication failure
  client.on('auth_failure', (err) => {
    console.error(`Authentication failed for ${clientId}: ${err.message}`);
    
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'AUTH_FAILURE',
        message: 'WhatsApp authentication failed'
      }));
    }
  });
  
  // Handle client ready
  client.on('ready', async () => {
    console.log(`WhatsApp client ready for: ${clientId}`);
    
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({
        type: 'connection_success',
        session_id: clientId
      }));
    }
    
    // Initialize status monitoring
    await monitorStatusUpdates(client, clientId, ws);
  });
  
  // Initialize client
  client.initialize();
  
  return client;
}

// Monitor status updates
async function monitorStatusUpdates(client, clientId, ws) {
  try {
    console.log(`Starting status monitoring for: ${clientId}`);
    
    // Set up status listener
    client.on('message', async (msg) => {
      if (msg.from === 'status@broadcast') {
        console.log(`New status detected for client: ${clientId}`);
        
        // Process and send status update
        const status = {
          id: msg.id.id,
          timestamp: msg.timestamp * 1000,
          is_video: msg.hasMedia && (msg.type === 'video' || msg.type === 'gif'),
          thumbnail_url: '',
          media_url: '',
          author: msg.author || 'Unknown',
        };
        
        if (ws && ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({
            type: 'status_update',
            statuses: [status]
          }));
        }
      }
    });
    
    // Get initial statuses
    const chats = await client.getChats();
    const statusChat = chats.find(chat => chat.name === 'Status updates');
    
    if (statusChat) {
      const messages = await statusChat.fetchMessages({ limit: 20 });
      const statuses = messages
        .filter(msg => msg.from === 'status@broadcast')
        .map(msg => ({
          id: msg.id.id,
          timestamp: msg.timestamp * 1000,
          is_video: msg.hasMedia && (msg.type === 'video' || msg.type === 'gif'),
          thumbnail_url: '',
          media_url: '',
          author: msg.author || 'Unknown',
        }));
      
      console.log(`Found ${statuses.length} initial statuses for client: ${clientId}`);
      
      if (statuses.length > 0 && ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'status_update',
          statuses: statuses
        }));
      }
    }
  } catch (err) {
    console.error(`Error monitoring statuses: ${err.message}`);
    
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'MONITOR_ERROR',
        message: `Error monitoring statuses: ${err.message}`
      }));
    }
  }
}

module.exports = {
  setupWhatsAppClient,
  monitorStatusUpdates
};
