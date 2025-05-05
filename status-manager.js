// Handle client messages
async function handleClientMessage(clientId, data, ws, clients, whatsappClients) {
  const { type } = data;
  const client = clients.get(clientId);
  
  if (!client) {
    console.error(`Client not found: ${clientId}`);
    return;
  }
  
  const sessionId = client.sessionId;
  const whatsappClient = sessionId ? whatsappClients.get(sessionId) : null;
  
  switch (type) {
    case 'heartbeat':
      // Just update last activity timestamp
      break;
      
    case 'authenticate':
      // Already handled during connection setup
      break;
      
    case 'request_status_updates':
      console.log(`Status updates requested by client: ${clientId}`);
      if (whatsappClient) {
        try {
          await refreshStatuses(whatsappClient, ws);
        } catch (err) {
          console.error(`Error refreshing statuses: ${err.message}`);
          ws.send(JSON.stringify({
            type: 'error',
            code: 'REFRESH_ERROR',
            message: `Error refreshing statuses: ${err.message}`
          }));
        }
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'NO_CLIENT',
          message: 'No WhatsApp client available'
        }));
      }
      break;
      
    case 'request_media':
      const { status_id } = data;
      console.log(`Media requested for status: ${status_id} by client: ${clientId}`);
      
      if (whatsappClient) {
        try {
          await downloadAndSendMedia(status_id, whatsappClient, ws);
        } catch (err) {
          console.error(`Error downloading media: ${err.message}`);
          ws.send(JSON.stringify({
            type: 'error',
            code: 'MEDIA_ERROR',
            message: `Error downloading media: ${err.message}`
          }));
        }
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'NO_CLIENT',
          message: 'No WhatsApp client available'
        }));
      }
      break;
      
    case 'request_thumbnail':
      const { status_id: thumbnailStatusId } = data;
      console.log(`Thumbnail requested for status: ${thumbnailStatusId} by client: ${clientId}`);
      
      if (whatsappClient) {
        try {
          await generateAndSendThumbnail(thumbnailStatusId, whatsappClient, ws);
        } catch (err) {
          console.error(`Error generating thumbnail: ${err.message}`);
          ws.send(JSON.stringify({
            type: 'error',
            code: 'THUMBNAIL_ERROR',
            message: `Error generating thumbnail: ${err.message}`
          }));
        }
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'NO_CLIENT',
          message: 'No WhatsApp client available'
        }));
      }
      break;
  }
}

// Refresh status updates
async function refreshStatuses(whatsappClient, ws) {
  try {
    const chats = await whatsappClient.getChats();
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
      
      if (statuses.length > 0 && ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'status_update',
          statuses: statuses
        }));
      }
    }
  } catch (err) {
    console.error(`Error refreshing statuses: ${err}`);
    throw err;
  }
}

// Download and send media
async function downloadAndSendMedia(statusId, whatsappClient, ws) {
  try {
    // Find the message by ID
    const msg = await whatsappClient.getMessageById(statusId);
    
    if (!msg) {
      throw new Error('Status not found');
    }
    
    if (!msg.hasMedia) {
      throw new Error('Status has no media');
    }
    
    // Download media
    const media = await msg.downloadMedia();
    
    // Send media data to client
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({
        type: 'media_data',
        status_id: statusId,
        data: media.data,
        mime_type: media.mimetype
      }));
    }
  } catch (err) {
    console.error(`Error downloading media: ${err}`);
    throw err;
  }
}

// Generate and send thumbnail
async function generateAndSendThumbnail(statusId, whatsappClient, ws) {
  try {
    // Find the message by ID
    const msg = await whatsappClient.getMessageById(statusId);
    
    if (!msg) {
      throw new Error('Status not found');
    }
    
    if (!msg.hasMedia) {
      throw new Error('Status has no media');
    }
    
    // Download media for thumbnail
    const media = await msg.downloadMedia();
    
    // In a real implementation, you would generate a thumbnail here
    // For simplicity, we're just sending the full media as a thumbnail
    
    // Send thumbnail data to client
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({
        type: 'thumbnail_data',
        status_id: statusId,
        data: media.data,
        mime_type: media.mimetype
      }));
    }
  } catch (err) {
    console.error(`Error generating thumbnail: ${err}`);
    throw err;
  }
}

module.exports = {
  handleClientMessage,
  refreshStatuses,
  downloadAndSendMedia,
  generateAndSendThumbnail
};
