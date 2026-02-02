#!/bin/bash
# =============================================================================
# Arcium Devnet Deployment Script
# =============================================================================
# This script automates the deployment of the Privacy DeFi program to devnet
# with off-chain circuit storage on Pinata.
#
# Usage:
#   1. Set the configuration variables below
#   2. Make executable: chmod +x deploy_devnet.sh
#   3. Run: ./deploy_devnet.sh
#
# =============================================================================

set -e  # Exit on any error

# =============================================================================
# CONFIGURATION - Set these values before running
# =============================================================================

# Your Helius RPC URL for devnet
HELIUS_RPC_URL="https://devnet.helius-rpc.com/?api-key=a8e1a5ce-29c6-4356-b3f9-54c1c650ac08"

# Path to your Solana keypair
KEYPAIR_PATH="$HOME/.config/solana/id.json"

# Pinata API credentials
PINATA_API_KEY="016d836ee3eb37002836"
PINATA_SECRET_KEY="71c06d316fe0201cfd677fe179c772d5f12fac33822097f65b50f336fdd5f313"

# Project paths
PROJECT_DIR="/Users/moura/repo/sol-privacy-mvp"
CONTRACT_DIR="$PROJECT_DIR/contract"
BUILD_DIR="$CONTRACT_DIR/build"

# Arcium cluster configuration (v0.6.3)
CLUSTER_OFFSET=456
RECOVERY_SET_SIZE=4

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

log_info() {
    echo -e "\033[1;34m[INFO]\033[0m $1"
}

log_success() {
    echo -e "\033[1;32m[SUCCESS]\033[0m $1"
}

log_error() {
    echo -e "\033[1;31m[ERROR]\033[0m $1"
}

log_warning() {
    echo -e "\033[1;33m[WARNING]\033[0m $1"
}

check_command() {
    if ! command -v "$1" &> /dev/null; then
        log_error "$1 is required but not installed."
        exit 1
    fi
}

# =============================================================================
# STEP 0: Validate Environment
# =============================================================================

validate_environment() {
    log_info "Validating environment..."
    
    check_command "arcium"
    check_command "solana"
    check_command "anchor"
    check_command "curl"
    check_command "jq"
    
    # Check if keypair exists
    if [ ! -f "$KEYPAIR_PATH" ]; then
        log_error "Keypair not found at $KEYPAIR_PATH"
        exit 1
    fi
    
    # Check SOL balance
    log_info "Checking SOL balance..."
    BALANCE=$(solana balance --keypair "$KEYPAIR_PATH" --url "$HELIUS_RPC_URL" | awk '{print $1}')
    log_info "Current balance: $BALANCE SOL"
    
    if (( $(echo "$BALANCE < 2" | bc -l) )); then
        log_warning "Balance may be insufficient. Recommended: 2-5 SOL"
    fi
    
    log_success "Environment validated"
}

# =============================================================================
# STEP 1: Build Arcium Project
# =============================================================================

build_project() {
    log_info "Building Arcium project..."
    cd "$CONTRACT_DIR"
    arcium build
    log_success "Build completed"
}

# =============================================================================
# STEP 2: Upload Circuits to Pinata
# =============================================================================

upload_to_pinata() {
    local FILE_PATH=$1
    local FILE_NAME=$(basename "$FILE_PATH")
    
    # Log to stderr so it doesn't mix with the returned CID
    echo -e "\033[1;34m[INFO]\033[0m Uploading $FILE_NAME to Pinata..." >&2
    
    RESPONSE=$(curl -s -X POST \
        -H "pinata_api_key: $PINATA_API_KEY" \
        -H "pinata_secret_api_key: $PINATA_SECRET_KEY" \
        -F "file=@$FILE_PATH" \
        https://api.pinata.cloud/pinning/pinFileToIPFS)
    
    CID=$(echo "$RESPONSE" | jq -r '.IpfsHash')
    
    if [ "$CID" = "null" ] || [ -z "$CID" ]; then
        echo -e "\033[1;31m[ERROR]\033[0m Failed to upload $FILE_NAME: $(echo "$RESPONSE" | jq -r '.error.message // .error // "Unknown error"')" >&2
        return 1
    fi
    
    # Return only the CID on stdout
    echo "$CID"
}

upload_all_circuits() {
    log_info "Uploading circuit files to Pinata..."
    
    CIRCUITS=("add_balance" "sub_balance" "transfer" "accumulate_order" "init_batch_state" "reveal_batch" "calculate_payout" "add_together")
    
    # Create output file for URLs
    OUTPUT_FILE="$BUILD_DIR/pinata_urls.json"
    echo "{" > "$OUTPUT_FILE"
    
    FIRST=true
    for CIRCUIT in "${CIRCUITS[@]}"; do
        ARCIS_FILE="$BUILD_DIR/${CIRCUIT}.arcis"
        
        if [ ! -f "$ARCIS_FILE" ]; then
            log_error "Circuit file not found: $ARCIS_FILE"
            continue
        fi
        
        CID=$(upload_to_pinata "$ARCIS_FILE")
        
        if [ -n "$CID" ] && [ "$CID" != "null" ]; then
            URL="https://gateway.pinata.cloud/ipfs/$CID"
            log_success "$CIRCUIT: $URL"
            
            if [ "$FIRST" = true ]; then
                FIRST=false
            else
                echo "," >> "$OUTPUT_FILE"
            fi
            echo "  \"$CIRCUIT\": \"$URL\"" >> "$OUTPUT_FILE"
        fi
    done
    
    echo "}" >> "$OUTPUT_FILE"
    log_success "Pinata URLs saved to $OUTPUT_FILE"
}

# =============================================================================
# STEP 3: Deploy Program Only (using solana CLI for reliability)
# =============================================================================

deploy_program() {
    log_info "Deploying program to devnet (program only, no MXE init)..."
    cd "$CONTRACT_DIR"
    
    # Check for existing buffers and close them
    log_info "Checking for existing program buffers..."
    BUFFERS=$(solana program show --buffers --url "$HELIUS_RPC_URL" 2>/dev/null | grep -v "Buffer Address" | grep -v "^$" || true)
    if [ -n "$BUFFERS" ]; then
        log_warning "Found existing buffers. Closing to recover SOL..."
        echo "$BUFFERS" | while read -r line; do
            BUFFER_ADDR=$(echo "$line" | awk '{print $1}')
            if [ -n "$BUFFER_ADDR" ]; then
                solana program close "$BUFFER_ADDR" --url "$HELIUS_RPC_URL" --keypair "$KEYPAIR_PATH" 2>/dev/null || true
            fi
        done
    fi
    
    log_info "Deploying program with solana CLI..."
    solana program deploy target/deploy/shuffle_protocol.so \
        --url "$HELIUS_RPC_URL" \
        --keypair "$KEYPAIR_PATH" \
        --with-compute-unit-price 1000 \
        --max-sign-attempts 100 \
        --use-rpc
    
    log_success "Program deployed successfully"
    log_info "Now run option 6 to initialize MXE"
}

# =============================================================================
# STEP 4: Initialize MXE (after program is deployed)
# =============================================================================

initialize_mxe() {
    local PROGRAM_ID=$1
    
    log_info "Initializing MXE for program $PROGRAM_ID..."
    cd "$CONTRACT_DIR"
    
    # Use arcium deploy with --skip-deploy to only initialize MXE
    arcium deploy \
        --cluster-offset "$CLUSTER_OFFSET" \
        --recovery-set-size "$RECOVERY_SET_SIZE" \
        --keypair-path "$KEYPAIR_PATH" \
        --rpc-url "$HELIUS_RPC_URL" \
        --skip-deploy
    
    log_success "MXE initialized successfully"
    log_info "Now run option 8 to initialize computation definitions"
}

# =============================================================================
# STEP 5: Upload IDL
# =============================================================================

upload_idl() {
    local PROGRAM_ID=$1
    
    log_info "Uploading IDL for program $PROGRAM_ID..."
    cd "$CONTRACT_DIR"
    
    # Try init first, if fails try upgrade
    if anchor idl init --filepath target/idl/shuffle_protocol.json "$PROGRAM_ID" \
        --provider.cluster devnet \
        --provider.wallet "$KEYPAIR_PATH" 2>/dev/null; then
        log_success "IDL initialized"
    else
        log_info "IDL init failed, trying upgrade..."
        anchor idl upgrade --filepath target/idl/shuffle_protocol.json "$PROGRAM_ID" \
            --provider.cluster devnet \
            --provider.wallet "$KEYPAIR_PATH"
        log_success "IDL upgraded"
    fi
}

# =============================================================================
# STEP 6: Initialize Computation Definitions
# =============================================================================

init_comp_defs() {
    log_info "Initializing computation definitions..."
    cd "$CONTRACT_DIR"
    
    # Check if the TypeScript script exists
    if [ ! -f "scripts/init_devnet_comp_defs.ts" ]; then
        log_error "init_devnet_comp_defs.ts not found!"
        return 1
    fi
    
    # Run the TypeScript initialization script
    log_info "Running TypeScript initialization script..."
    npx ts-node scripts/init_devnet_comp_defs.ts
    
    log_success "Computation definitions initialized"
}

# =============================================================================
# STEP 7: Create Token Mints
# =============================================================================

create_token_mints() {
    log_info "Creating SPL token mints..."
    
    MINTS_FILE="$BUILD_DIR/token_mints.json"
    echo "{" > "$MINTS_FILE"
    
    # Create USDC
    log_info "Creating USDC mint..."
    USDC_OUTPUT=$(spl-token create-token --decimals 6 --url "$HELIUS_RPC_URL" --fee-payer "$KEYPAIR_PATH" 2>&1)
    USDC_MINT=$(echo "$USDC_OUTPUT" | grep "Address:" | awk '{print $2}')
    echo "  \"USDC\": \"$USDC_MINT\"," >> "$MINTS_FILE"
    log_success "USDC: $USDC_MINT"
    
    # Create TSLA
    log_info "Creating TSLA mint..."
    TSLA_OUTPUT=$(spl-token create-token --decimals 6 --url "$HELIUS_RPC_URL" --fee-payer "$KEYPAIR_PATH" 2>&1)
    TSLA_MINT=$(echo "$TSLA_OUTPUT" | grep "Address:" | awk '{print $2}')
    echo "  \"TSLA\": \"$TSLA_MINT\"," >> "$MINTS_FILE"
    log_success "TSLA: $TSLA_MINT"
    
    # Create SPY
    log_info "Creating SPY mint..."
    SPY_OUTPUT=$(spl-token create-token --decimals 6 --url "$HELIUS_RPC_URL" --fee-payer "$KEYPAIR_PATH" 2>&1)
    SPY_MINT=$(echo "$SPY_OUTPUT" | grep "Address:" | awk '{print $2}')
    echo "  \"SPY\": \"$SPY_MINT\"," >> "$MINTS_FILE"
    log_success "SPY: $SPY_MINT"
    
    # Create AAPL
    log_info "Creating AAPL mint..."
    AAPL_OUTPUT=$(spl-token create-token --decimals 6 --url "$HELIUS_RPC_URL" --fee-payer "$KEYPAIR_PATH" 2>&1)
    AAPL_MINT=$(echo "$AAPL_OUTPUT" | grep "Address:" | awk '{print $2}')
    echo "  \"AAPL\": \"$AAPL_MINT\"" >> "$MINTS_FILE"
    log_success "AAPL: $AAPL_MINT"
    
    echo "}" >> "$MINTS_FILE"
    log_success "Token mints saved to $MINTS_FILE"
}

# =============================================================================
# STEP 8: Verify Deployment
# =============================================================================

verify_deployment() {
    local PROGRAM_ID=$1
    
    log_info "Verifying deployment..."
    
    solana program show "$PROGRAM_ID" --url "$HELIUS_RPC_URL"
    
    log_info "Fetching IDL..."
    anchor idl fetch "$PROGRAM_ID" --provider.cluster devnet > /dev/null 2>&1 && \
        log_success "IDL verified" || log_warning "Could not fetch IDL"
}

# =============================================================================
# STEP 9: Generate Rust Code Snippet
# =============================================================================

generate_rust_snippet() {
    log_info "Generating Rust code snippet for off-chain circuits..."
    
    URLS_FILE="$BUILD_DIR/pinata_urls.json"
    SNIPPET_FILE="$CONTRACT_DIR/offchain_circuits_snippet.rs"
    
    if [ ! -f "$URLS_FILE" ]; then
        log_error "Pinata URLs file not found. Run upload_all_circuits first."
        return 1
    fi
    
    cat > "$SNIPPET_FILE" << 'EOF'
// =============================================================================
// OFF-CHAIN CIRCUIT CONFIGURATION
// =============================================================================
// Add these imports at the top of lib.rs:
//
// use arcium_client::idl::arcium::types::{CircuitSource, OffChainCircuitSource};
// use arcium_macros::circuit_hash;
//
// Then replace each init_*_comp_def function with the version below.
// =============================================================================

EOF

    CIRCUITS=("add_balance" "sub_balance" "transfer" "accumulate_order" "init_batch_state" "reveal_batch" "calculate_payout" "add_together")
    
    for CIRCUIT in "${CIRCUITS[@]}"; do
        URL=$(jq -r ".\"$CIRCUIT\"" "$URLS_FILE")
        FUNC_NAME="init_${CIRCUIT}_comp_def"
        CONTEXT_NAME=$(echo "$CIRCUIT" | sed 's/_\([a-z]\)/\U\1/g; s/^\([a-z]\)/\U\1/')
        
        cat >> "$SNIPPET_FILE" << EOF
pub fn ${FUNC_NAME}(ctx: Context<Init${CONTEXT_NAME}CompDef>) -> Result<()> {
    init_comp_def(
        ctx.accounts,
        Some(CircuitSource::OffChain(OffChainCircuitSource {
            source: "$URL".to_string(),
            hash: circuit_hash!("$CIRCUIT"),
        })),
        None,
    )?;
    Ok(())
}

EOF
    done
    
    log_success "Rust snippet saved to $SNIPPET_FILE"
}

# =============================================================================
# MAIN MENU
# =============================================================================

show_menu() {
    echo ""
    echo "============================================"
    echo "  Arcium Devnet Deployment Script"
    echo "============================================"
    echo "1.  Validate environment"
    echo "2.  Build project"
    echo "3.  Upload circuits to Pinata"
    echo "4.  Generate Rust code snippet"
    echo "5.  Deploy program (solana CLI)"
    echo "6.  Initialize MXE (requires program deployed)"
    echo "7.  Upload IDL"
    echo "8.  Initialize computation definitions"
    echo "9.  Create token mints"
    echo "10. Verify deployment"
    echo "11. Exit"
    echo ""
    echo "Current Program ID (from devnet_config.json if exists):"
    if [ -f "$CONTRACT_DIR/devnet_config.json" ]; then
        jq -r '.program_id // "Not set"' "$CONTRACT_DIR/devnet_config.json"
    else
        echo "Not configured"
    fi
    echo ""
    read -p "Select option [1-11]: " CHOICE
    
    case $CHOICE in
        1) validate_environment ;;
        2) build_project ;;
        3) upload_all_circuits ;;
        4) generate_rust_snippet ;;
        5) deploy_program ;;
        6) 
            read -p "Enter Program ID: " PROGRAM_ID
            initialize_mxe "$PROGRAM_ID"
            ;;
        7) 
            read -p "Enter Program ID: " PROGRAM_ID
            upload_idl "$PROGRAM_ID"
            ;;
        8) init_comp_defs ;;
        9) create_token_mints ;;
        10)
            read -p "Enter Program ID: " PROGRAM_ID
            verify_deployment "$PROGRAM_ID"
            ;;
        11) exit 0 ;;
        *) log_error "Invalid option" ;;
    esac
    
    show_menu
}

# =============================================================================
# ENTRY POINT
# =============================================================================

show_menu

