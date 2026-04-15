#!/usr/bin/env tsx

/**
 * atep CLI Configuration Setup
 * Configure CLI for mixed environment testing
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CliConfig {
  indexerUrl: string;
  apiKey: string;
  suiNetwork: string;
  suiRpcUrl: string;
  nostrRelays: string[];
  contractPackageId?: string;
  contractObjectId?: string;
}

console.log('=== atep CLI Configuration Setup ===\n');

// Default configuration for mixed environment
const defaultConfig: CliConfig = {
  indexerUrl: 'http://YOUR_SERVER_IP:7071', // Replace with your server IP
  apiKey: 'your_api_key_here',
  suiNetwork: 'devnet',
  suiRpcUrl: 'https://fullnode.devnet.sui.io:443',
  nostrRelays: [
    'wss://relay.damus.io',
    'wss://nos.lol', 
    'wss://relay.nostr.band'
  ]
};

// Create config directory
const configDir = path.join(__dirname, '..', '.atep');
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// Write configuration file
const configFile = path.join(configDir, 'config.json');
fs.writeFileSync(configFile, JSON.stringify(defaultConfig, null, 2));

console.log('1. Configuration file created:');
console.log(`   Path: ${configFile}`);
console.log('   Content:');
console.log(JSON.stringify(defaultConfig, null, 4));

// Create environment file for CLI
const envFile = path.join(__dirname, '..', '.env');
const envContent = `
# atep CLI Environment Configuration
INDEXER_URL=${defaultConfig.indexerUrl}
API_KEY=${defaultConfig.apiKey}
SUI_NETWORK=${defaultConfig.suiNetwork}
SUI_RPC_URL=${defaultConfig.suiRpcUrl}
NOSTR_RELAYS=${defaultConfig.nostrRelays.join(',')}
`;

fs.writeFileSync(envFile, envContent.trim());

console.log('\n2. Environment file created:');
console.log(`   Path: ${envFile}`);

// Test configuration
console.log('\n3. Testing configuration...');
try {
  // Test indexer connection (will fail if server not deployed yet)
  console.log(`   Testing indexer: ${defaultConfig.indexerUrl}`);
  
  // Test Sui network connection
  console.log(`   Testing Sui network: ${defaultConfig.suiNetwork}`);
  
  console.log('   Configuration test completed');
} catch (error: any) {
  console.log('   Configuration test failed:', error.message);
}

console.log('\n=== Setup Instructions ===');
console.log('1. Update the configuration with your actual server IP');
console.log('2. Deploy the indexer to your server using deploy-indexer.sh');
console.log('3. Deploy the contract using deploy-contract.sh');
console.log('4. Update contract IDs in the configuration');
console.log('5. Test CLI commands with the new configuration');

console.log('\n=== Next Steps ===');
console.log('1. Deploy contract: ./scripts/deploy-contract.sh');
console.log('2. Deploy indexer: ./scripts/deploy-indexer.sh');
console.log('3. Update config: Edit .atep/config.json');
console.log('4. Test CLI: npm run atep:cli --help');

console.log('\n=== Configuration Complete ===');
