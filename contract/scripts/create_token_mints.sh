#!/bin/bash
set -e

HELIUS_RPC_URL="https://devnet.helius-rpc.com/?api-key=a8e1a5ce-29c6-4356-b3f9-54c1c650ac08"
KEYPAIR_PATH="$HOME/.config/solana/id.json"
BUILD_DIR="build"

echo "Creating SPL token mints on devnet..."
echo ""

MINTS_FILE="$BUILD_DIR/token_mints.json"
echo "{" > "$MINTS_FILE"

# Create USDC
echo "Creating USDC mint..."
USDC_OUTPUT=$(spl-token create-token --decimals 6 --url "$HELIUS_RPC_URL" --fee-payer "$KEYPAIR_PATH" 2>&1)
USDC_MINT=$(echo "$USDC_OUTPUT" | grep "Address:" | awk '{print $2}' | head -1)
echo "  ✓ USDC: $USDC_MINT"
echo "  \"USDC\": \"$USDC_MINT\"," >> "$MINTS_FILE"

# Create TSLA
echo "Creating TSLA mint..."
TSLA_OUTPUT=$(spl-token create-token --decimals 6 --url "$HELIUS_RPC_URL" --fee-payer "$KEYPAIR_PATH" 2>&1)
TSLA_MINT=$(echo "$TSLA_OUTPUT" | grep "Address:" | awk '{print $2}' | head -1)
echo "  ✓ TSLA: $TSLA_MINT"
echo "  \"TSLA\": \"$TSLA_MINT\"," >> "$MINTS_FILE"

# Create SPY
echo "Creating SPY mint..."
SPY_OUTPUT=$(spl-token create-token --decimals 6 --url "$HELIUS_RPC_URL" --fee-payer "$KEYPAIR_PATH" 2>&1)
SPY_MINT=$(echo "$SPY_OUTPUT" | grep "Address:" | awk '{print $2}' | head -1)
echo "  ✓ SPY: $SPY_MINT"
echo "  \"SPY\": \"$SPY_MINT\"," >> "$MINTS_FILE"

# Create AAPL
echo "Creating AAPL mint..."
AAPL_OUTPUT=$(spl-token create-token --decimals 6 --url "$HELIUS_RPC_URL" --fee-payer "$KEYPAIR_PATH" 2>&1)
AAPL_MINT=$(echo "$AAPL_OUTPUT" | grep "Address:" | awk '{print $2}' | head -1)
echo "  ✓ AAPL: $AAPL_MINT"
echo "  \"AAPL\": \"$AAPL_MINT\"" >> "$MINTS_FILE"

echo "}" >> "$MINTS_FILE"
echo ""
echo "✓ Token mints saved to $MINTS_FILE"
cat "$MINTS_FILE"
