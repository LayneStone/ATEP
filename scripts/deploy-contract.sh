#!/bin/bash

# atep Contract Deployment Script
# Deploy to Sui DevNet

echo "=== atep Contract Deployment ==="

# Check Sui CLI
if ! command -v sui &> /dev/null; then
    echo "Error: sui CLI not found. Please install Sui CLI first."
    echo "Install: curl -mfsSL https://install.sui.io | bash"
    exit 1
fi

# Check network connection
echo "1. Checking Sui DevNet connection..."
sui client active-address > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "Setting up Sui DevNet..."
    sui client new-address --keyscheme ed25519
    sui client switch --network devnet
fi

# Get current address
CURRENT_ADDRESS=$(sui client active-address)
echo "   Current address: $CURRENT_ADDRESS"

# Request test funds
echo "2. Requesting test funds..."
sui client faucet --network devnet

# Wait for funds
echo "3. Waiting for funds to arrive..."
sleep 10

# Check balance
echo "4. Checking balance..."
sui client gas

# Deploy contract
echo "5. Deploying atep contract..."
cd /Users/shuaiqi/Documents/atep/contracts-sui

# Build and deploy
sui client publish --gas-budget 100000000

echo "6. Contract deployed successfully!"
echo "   Note the package ID and object IDs from the output"
echo "   Update CLI config with these IDs"

echo "=== Deployment Complete ==="
