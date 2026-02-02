#!/bin/bash
set -e

URLS_FILE="build/pinata_urls.json"
SNIPPET_FILE="offchain_circuits_snippet.rs"

if [ ! -f "$URLS_FILE" ]; then
    echo "Error: Pinata URLs file not found at $URLS_FILE"
    exit 1
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

    # Convert snake_case to PascalCase for context name
    CONTEXT_NAME=$(echo "$CIRCUIT" | sed 's/_\([a-z]\)/\U\1/g; s/^./\U&/')

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

echo "✓ Rust snippet saved to $SNIPPET_FILE"
cat "$SNIPPET_FILE"
