use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::errors::ErrorCode;
use crate::{ExecuteBatch, RevealBatchCallback};

// =============================================================================
// EXECUTE BATCH - Queue MPC to Reveal Totals (Phase 9)
// =============================================================================
// Execute the current batch by revealing aggregated totals.
// After MPC reveals totals, the callback performs netting and external swaps.
//
// Flow:
// 1. Operator calls execute_batch
// 2. Handler queues reveal_batch MPC computation
// 3. Callback receives plaintext totals for all 6 pairs
// 4. Callback performs netting algorithm for each pair
// 5. Callback CPIs to Jupiter for net surplus swaps
// 6. Callback creates BatchLog PDA with results
// 7. Callback resets BatchAccumulator for next batch

/// Execute the current batch.
/// Queues MPC to reveal aggregate totals, then callback handles netting and swaps.
///
/// # Arguments
/// * `computation_offset` - Unique ID for this MPC computation
pub fn handler(ctx: Context<ExecuteBatch>, computation_offset: u64) -> Result<()> {
    // Set sign PDA bump
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // Build MPC arguments: read batch accumulator encrypted state
    // Skip discriminator (8) + batch_id (8) + order_count (1) = 17 bytes
    // Read 12 ciphertexts × 32 bytes = 384 bytes (pairs only)
    let args = ArgBuilder::new()
        .plaintext_u128(ctx.accounts.batch_accumulator.mxe_nonce) // Use stored MXE nonce
        .account(
            ctx.accounts.batch_accumulator.key(),
            8 + 8 + 1, // Skip discriminator + batch_id + order_count
            6 * 64,    // 12 ciphertexts × 32 bytes = 384 bytes
        )
        .build();

    // Queue MPC computation with callback
    use arcium_client::idl::arcium::types::CallbackAccount;
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![RevealBatchCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[
                CallbackAccount {
                    pubkey: ctx.accounts.batch_accumulator.key(),
                    is_writable: true,
                },
                CallbackAccount {
                    pubkey: ctx.accounts.batch_log.key(),
                    is_writable: true,
                },
                // TODO: Re-add these accounts after testing callback limit
                // CallbackAccount {
                //     pubkey: ctx.accounts.pool.key(),
                //     is_writable: false,
                // },
                // Vault and reserve accounts temporarily removed
            ],
        )?],
        1, // number of callbacks
        0, // priority
    )?;

    msg!(
        "Batch execution queued: batch_id={}, computation={}",
        ctx.accounts.batch_accumulator.batch_id,
        computation_offset
    );

    Ok(())
}
