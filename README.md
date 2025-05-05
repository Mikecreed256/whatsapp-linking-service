# WhatsApp Status Linking Service

A lightweight backend service for linking WhatsApp statuses with the Unisaver app using Baileys.

## Overview

This service enables the Unisaver app to connect to WhatsApp via QR code and receive status updates. It uses Baileys, a lightweight WebSocket-based WhatsApp Web API that doesn't require Puppeteer or Chrome, making it ideal for deployment on Render.

## Features

- QR code generation for WhatsApp linking
- WebSocket connection for real-time status updates
- Session persistence across app restarts
- Support for multiple simultaneous client connections
- Lightweight implementation without Chrome/Puppeteer dependency

## Prerequisites

- Node.js 14+ 
- NPM or Yarn
- Git

## Setup and Deployment on Render

### 1. Prepare Your Repository

1. Add the files from this implementation to your existing GitHub repository:
   - `server.js`
   - `package.json`
   - `.env.example` (rename to `.env` and configure)

2. Commit the changes to your repository:
   ```bash
   git add .
   git commit -m "Add WhatsApp linking service using Baileys"
   git push
   ```

### 2. Create a New Web Service on Render

1. Log in to your Render dashboard
2. Click "New" and select "Web Service"
3. Connect your GitHub repository
4. Configure the service:
   - **Name**: `whatsapp-linking-service` (or any name you prefer)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`

### 3. Configure Environment Variables

1. In the Render dashboard, go to the "Environment" tab for your service
2. Add the following environment variables:
   - `PORT`: Leave empty (Render assigns this automatically)
   - `NODE_ENV`: `production`
   - `API_KEY`: Generate a secure random string
   - (Add other variables from `.env.example` as needed)

### 4. Deploy the Service

1. Click "Manual Deploy" > "Deploy latest commit"
2. Wait for the build and deployment to complete
3. Once deployed, Render will provide a URL for your service

## Integration with the Flutter App

Update your Flutter app to connect to this backend:

1. Replace the direct file access implementation with WebSocket connection
2. Use the provided WebSocket URL from Render in your app
3. Implement the QR code scanning UI
4. Handle status updates received via WebSocket

## Maintenance

- Monitor the service logs in Render dashboard
- Set up automated health checks
- Consider upgrading to a paid plan if you need more resources

## Security Considerations

- The API key in environment variables should be used to secure endpoints
- WebSocket connections should validate client identity
- Consider adding rate limiting for production use

## Legal Notice

This project is not affiliated with, endorsed by, or connected to WhatsApp Inc. in any way. This is an independent project created for educational purposes. Use responsibly and in accordance with WhatsApp's Terms of Service.
