use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::errors::ErrorCode;
use crate::{AccumulateOrderCallback, PlaceOrder};

// =============================================================================
// PLACE ORDER - Queue Encrypted Order (Phase 8)
// =============================================================================
// Place an encrypted order in the current batch.
// The order's pair_id, direction, and amount are encrypted on-chain.
// Only aggregated batch totals are revealed during execution.
//
// Flow:
// 1. User calls place_order with encrypted order details
// 2. Handler stores OrderTicket in user_account.pending_order
// 3. Handler queues MPC computation (accumulate_order circuit)
// 4. Callback receives updated balance + batch state from MPC
// 5. Callback updates batch accumulator and checks auto-trigger conditions
//

/// Place an encrypted order in the current batch.
/// Stores OrderTicket and queues MPC computation.
///
/// # Arguments
/// * `computation_offset` - Unique ID for this MPC computation
/// * `encrypted_pair_id` - Pair ID (0-5) encrypted with user's key
/// * `encrypted_direction` - Direction (0=A_to_B, 1=B_to_A) encrypted with user's key
/// * `encrypted_amount` - Order amount encrypted with user's key
/// * `pubkey` - User's x25519 public key for encryption
/// * `nonce` - Encryption nonce for the order input
/// * `source_asset_id` - Plaintext hint: which asset is being sold (0=USDC, 1=TSLA, 2=SPY, 3=AAPL)
pub fn handler(
    ctx: Context<PlaceOrder>,
    computation_offset: u64,
    encrypted_pair_id: [u8; 32],
    encrypted_direction: [u8; 32],
    encrypted_amount: [u8; 32],
    pubkey: [u8; 32],
    nonce: u128,
    source_asset_id: u8,
) -> Result<()> {
    // Validate asset_id
    require!(source_asset_id <= 3, ErrorCode::InvalidAssetId);

    // Validate no pending order exists (ensured by account constraint, but double-check)
    require!(
        ctx.accounts.user_account.pending_order.is_none(),
        ErrorCode::PendingOrderExists
    );

    // Store OrderTicket in user's pending_order
    use crate::state::OrderTicket;
    let batch_id = ctx.accounts.batch_accumulator.batch_id;
    ctx.accounts.user_account.pending_order = Some(OrderTicket {
        batch_id,
        pair_id: encrypted_pair_id,
        direction: encrypted_direction,
        encrypted_amount,
        order_nonce: nonce,
    });

    // Store source_asset_id for callback to know which balance to update
    ctx.accounts.user_account.pending_asset_id = source_asset_id;

    // Set sign PDA bump
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // Build MPC arguments:
    // 1. OrderInput (Enc<Shared>) - user encrypts
    // 2. UserBalance (Enc<Shared>) - current balance of source asset (user can decrypt output)
    // 3. BatchState (Enc<Mxe>) - current batch accumulator state (protocol-owned)

    let current_balance = ctx.accounts.user_account.get_credit(source_asset_id);
    let current_nonce = ctx.accounts.user_account.get_nonce(source_asset_id);

    let args = ArgBuilder::new()
        // OrderInput (Enc<Shared>) - encrypted by user
        .x25519_pubkey(pubkey)
        .plaintext_u128(nonce)
        .encrypted_u8(encrypted_pair_id) // pair_id
        .encrypted_u8(encrypted_direction) // direction
        .encrypted_u64(encrypted_amount) // amount
        // UserBalance (Enc<Shared>) - passed as encrypted input so user can decrypt output
        .x25519_pubkey(pubkey)
        .plaintext_u128(current_nonce)
        .encrypted_u64(current_balance)
        // BatchState (Enc<Mxe>) - read from batch accumulator account (protocol-owned)
        .plaintext_u128(ctx.accounts.batch_accumulator.mxe_nonce) // Use stored MXE nonce
        .account(
            ctx.accounts.batch_accumulator.key(),
            8 + 8 + 1, // Skip discriminator(8) + batch_id(8) + order_count(1)
            6 * 64,    // 12 ciphertexts × 32 bytes = 384 bytes (pairs only)
        )
        // order_count passed as plaintext input for batch_ready calculation
        .plaintext_u8(ctx.accounts.batch_accumulator.order_count)
        .build();

    // Queue MPC computation with callback
    use arcium_client::idl::arcium::types::CallbackAccount;
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![AccumulateOrderCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[
                CallbackAccount {
                    pubkey: ctx.accounts.user_account.key(),
                    is_writable: true,
                },
                CallbackAccount {
                    pubkey: ctx.accounts.batch_accumulator.key(),
                    is_writable: true,
                },
            ],
        )?],
        1, // number of callbacks
        0, // priority
    )?;

    msg!(
        "Order placed: user={}, batch={}, asset={}, computation={}",
        ctx.accounts.user.key(),
        batch_id,
        source_asset_id,
        computation_offset
    );

    Ok(())
}
