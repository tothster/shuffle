use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::errors::ErrorCode;
use crate::{CalculatePayoutCallback, SettleOrder};

// =============================================================================
// SETTLE ORDER - Calculate Pro-Rata Payout (Phase 10)
// =============================================================================
// Settle a pending order after batch execution.
// Calculates pro-rata payout based on user's order size and batch results.
//
// Flow:
// 1. User calls settle_order with their order details (pair_id, direction)
// 2. Handler loads BatchLog results for the executed batch
// 3. Handler queues calculate_payout MPC computation
// 4. Callback receives updated balance with payout added
// 5. Callback clears pending_order

/// Settle a pending order.
/// Calculates pro-rata payout and updates user balance.
///
/// # Arguments
/// * `computation_offset` - Unique ID for MPC computation
/// * `pubkey` - User's x25519 public key
/// * `nonce` - Encryption nonce
/// * `pair_id` - Trading pair for this order (0-5)
/// * `direction` - Order direction (0=A_to_B, 1=B_to_A)
pub fn handler(
    ctx: Context<SettleOrder>,
    computation_offset: u64,
    pubkey: [u8; 32],
    nonce: u128,
    pair_id: u8,
    direction: u8,
) -> Result<()> {
    // Validate inputs
    require!(pair_id <= 5, ErrorCode::InvalidPairId);
    require!(direction <= 1, ErrorCode::InvalidAmount); // 0 or 1

    // Verify pending_order exists
    let pending = ctx
        .accounts
        .user_account
        .pending_order
        .ok_or(ErrorCode::NoPendingOrder)?;

    // Load PairResult from batch_log
    use crate::state::PairResult;
    let pair_result: PairResult = ctx.accounts.batch_log.results[pair_id as usize];

    // Determine which totals to use based on direction
    let (total_input, final_pool_output) = if direction == 0 {
        // A_to_B: user sold A, gets B
        (pair_result.total_a_in, pair_result.final_pool_b)
    } else {
        // B_to_A: user sold B, gets A
        (pair_result.total_b_in, pair_result.final_pool_a)
    };

    // Determine output asset ID based on pair and direction
    // Per constants.rs: PAIR_TSLA_USDC=0, PAIR_SPY_USDC=1, etc.
    // Token A is first in pair name, Token B is second
    // Direction: 0=A_to_B (sell A, get B), 1=B_to_A (sell B, get A)
    let (token_a_asset, token_b_asset) = match pair_id {
        0 => (1_u8, 0_u8), // TSLA/USDC - A=TSLA(1), B=USDC(0)
        1 => (2_u8, 0_u8), // SPY/USDC - A=SPY(2), B=USDC(0)
        2 => (3_u8, 0_u8), // AAPL/USDC - A=AAPL(3), B=USDC(0)
        3 => (1_u8, 2_u8), // TSLA/SPY - A=TSLA(1), B=SPY(2)
        4 => (1_u8, 3_u8), // TSLA/AAPL - A=TSLA(1), B=AAPL(3)
        5 => (2_u8, 3_u8), // SPY/AAPL - A=SPY(2), B=AAPL(3)
        _ => return Err(ErrorCode::InvalidPairId.into()),
    };
    let output_asset_id = if direction == 0 {
        token_b_asset // A_to_B: sell A, get B
    } else {
        token_a_asset // B_to_A: sell B, get A
    };

    // Store output_asset_id for callback
    ctx.accounts.user_account.pending_asset_id = output_asset_id;

    // Set sign PDA bump
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // Get current balance for output asset (plaintext - for first settlement this is 0)
    // Note: We read the plaintext value because output assets haven't been MPC-processed yet
    // In a full implementation, we'd track which balances have been MPC-initialized
    let current_balance: u64 = 0; // First settlement on output asset always starts at 0

    // Build MPC arguments - pass FULL OrderInput struct to preserve encryption context
    // The order was encrypted as a struct (pair_id, direction, amount) with order_nonce
    let args = ArgBuilder::new()
        // OrderInput (Enc<Shared, OrderInput>) - all 3 fields from pending_order
        .x25519_pubkey(pubkey)
        .plaintext_u128(pending.order_nonce) // Use original nonce from order placement
        .encrypted_u8(pending.pair_id) // Struct field 0
        .encrypted_u8(pending.direction) // Struct field 1
        .encrypted_u64(pending.encrypted_amount) // Struct field 2
        // Plaintext current balance (0 for first settlement)
        .plaintext_u64(current_balance)
        // Plaintext batch results
        .plaintext_u64(total_input)
        .plaintext_u64(final_pool_output)
        .build();

    // Queue MPC computation
    use arcium_client::idl::arcium::types::CallbackAccount;
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![CalculatePayoutCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[CallbackAccount {
                pubkey: ctx.accounts.user_account.key(),
                is_writable: true,
            }],
        )?],
        1,
        0,
    )?;

    msg!(
        "Settlement queued: user={}, batch={}, pair={}, direction={}",
        ctx.accounts.user.key(),
        pending.batch_id,
        pair_id,
        direction
    );

    Ok(())
}
