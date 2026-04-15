#!/bin/bash

# atep Indexer Deployment Script
# Deploy to cloud server (VPS)

echo "=== atep Indexer Deployment ==="

# Server requirements check
echo "1. Checking server requirements..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js not found"
    exit 1
fi

# Check PM2 (process manager)
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    npm install -g pm2
fi

# Create deployment directory
echo "2. Setting up deployment directory..."
mkdir -p /opt/atep/indexer
cd /opt/atep/indexer

# Copy files (in production, use git clone or scp)
echo "3. Deploying indexer files..."
# cp -r /Users/shuaiqi/Documents/atep/indexer/* .
# cp -r /Users/shuaiqi/Documents/atep/package.json .

# Install dependencies
echo "4. Installing dependencies..."
npm install --production

# Create environment file
echo "5. Creating environment configuration..."
cat > .env << EOF
# atep Indexer Configuration
NODE_ENV=production
PORT=7071
SUI_NETWORK=devnet
SUI_RPC_URL=https://fullnode.devnet.sui.io:443

# Database (SQLite for simplicity)
DATABASE_PATH=/opt/atep/indexer/data/atep.db

# Nostr Relay Configuration
NOSTR_RELAY_URLS=wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band

# Logging
LOG_LEVEL=info
LOG_FILE=/opt/atep/indexer/logs/indexer.log

# Security
API_KEY=your_api_key_here
CORS_ORIGIN=*
EOF

# Create directories
mkdir -p data logs

# Build the project
echo "6. Building indexer..."
npm run build

# Start with PM2
echo "7. Starting indexer with PM2..."
pm2 start dist/index.js --name "atep-indexer" --env .env

# Save PM2 configuration
pm2 save
pm2 startup

# Check status
echo "8. Checking indexer status..."
pm2 status

# Test API
echo "9. Testing indexer API..."
sleep 5
curl -f http://localhost:7071/health || echo "Health check failed"

echo "=== Indexer Deployment Complete ==="
echo "API URL: http://YOUR_SERVER_IP:7071"
echo "API Key: your_api_key_here"
echo "Logs: pm2 logs atep-indexer"
