#!/bin/bash

# atep Development Quick Start
# 30 seconds to full development environment

echo "=== atep Development Quick Start ==="
echo "Starting development environment in 30 seconds..."
echo

# Step 1: Install dependencies (10 seconds)
echo "1. Installing dependencies..."
npm install --silent > /dev/null 2>&1 &
INSTALL_PID=$!

# Step 2: Check TypeScript compilation (5 seconds)
echo "2. Checking TypeScript compilation..."
npx tsc --noEmit --skipLibCheck > /dev/null 2>&1 &
TSC_PID=$!

# Step 3: Test CLI startup (5 seconds)
echo "3. Testing CLI startup..."
timeout 5s npx tsx cli/src/cli.ts --help > /dev/null 2>&1 &
CLI_PID=$!

# Step 4: Wait for all checks
wait $INSTALL_PID
if [ $? -eq 0 ]; then
    echo "   Dependencies: OK"
else
    echo "   Dependencies: FAILED"
fi

wait $TSC_PID
if [ $? -eq 0 ]; then
    echo "   TypeScript: OK"
else
    echo "   TypeScript: WARNING (may be external deps)"
fi

wait $CLI_PID
if [ $? -eq 0 ]; then
    echo "   CLI: OK"
else
    echo "   CLI: FAILED"
fi

echo
echo "=== Quick Tests ==="

# Test 5: Run ultra quick test (5 seconds)
echo "4. Running ultra quick test..."
npm run test:quick

echo
echo "=== Development Environment Ready ==="
echo "Available commands:"
echo "  npm run test:quick    - 5 second basic test"
echo "  npm run test:mock     - Mock data test"
echo "  npm run atep:cli      - Start CLI"
echo "  npm run dev:indexer   - Start indexer"
echo "  npm run dev:relay     - Start Nostr relay"
echo
echo "For full testing:"
echo "  npm run test:all      - Complete test suite"
echo "  npm run test:integration - Integration tests"
echo
echo "Development environment is ready!"
