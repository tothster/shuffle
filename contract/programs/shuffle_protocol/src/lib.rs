use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

// =============================================================================
// MODULE DECLARATIONS
// =============================================================================
// These modules organize our code into logical components.
//

/// Constants module: Asset IDs, limits, frequencies, PDA seeds
pub mod constants;

/// Error codes returned by our program
pub mod errors;

/// Instruction handlers: initialize, deposit, withdraw, etc.
pub mod instructions;

/// Account state structures: Pool, UserProfile, BatchAccumulator, BatchLog
pub mod state;

// Re-export errors for easier access
pub use errors::ErrorCode;

// =============================================================================
// ARCIUM COMPUTATION DEFINITION OFFSETS
// =============================================================================
// These identify different MPC computation types in the Arcium system.
//

const COMP_DEF_OFFSET_ADD_TOGETHER: u32 = comp_def_offset("add_together");
const COMP_DEF_OFFSET_ADD_BALANCE: u32 = comp_def_offset("add_balance");
const COMP_DEF_OFFSET_SUB_BALANCE: u32 = comp_def_offset("sub_balance");
const COMP_DEF_OFFSET_TRANSFER: u32 = comp_def_offset("transfer");
const COMP_DEF_OFFSET_ACCUMULATE_ORDER: u32 = comp_def_offset("accumulate_order");
const COMP_DEF_OFFSET_INIT_BATCH_STATE: u32 = comp_def_offset("init_batch_state");
const COMP_DEF_OFFSET_REVEAL_BATCH: u32 = comp_def_offset("reveal_batch");
const COMP_DEF_OFFSET_CALCULATE_PAYOUT: u32 = comp_def_offset("calculate_payout");

// =============================================================================
// PROGRAM ID
// =============================================================================
// This is the unique address of our deployed program on Solana.
//

declare_id!("CPaXkQZsWgJ47abuwAoCX61cSu5CZHSB4P4ETd3Rc5xU");

// Shuffle Protocol - A privacy-preserving DeFi protocol for private DCA into tokenized stocks
//
// This module contains the main program logic for:
// - User account creation with encrypted balances
// - Deposits/withdrawals with MPC-computed balance updates
// - Private swap orders with encrypted amounts
// - DCA (Dollar Cost Averaging) schedules
// - Batch order execution via Jupiter
//

// =============================================================================
// INTERNAL SWAP EXECUTION HELPERS
// =============================================================================
// These functions handle the actual token transfers during batch execution.
// They are defined OUTSIDE the #[arcium_program] module because Anchor's
// macro expansion doesn't play well with helper functions inside the module.

use anchor_spl::token::{self, Token, TokenAccount, Transfer};

/// Execute an internal swap by transferring tokens between vaults and reserves.
/// This is called during reveal_batch_callback to balance the pools.
///
/// # Arguments
/// * `from_vault` - Source vault account
/// * `to_reserve` - Destination reserve account  
/// * `pool` - Pool PDA (authority for vaults)
/// * `token_program` - SPL Token program
/// * `amount` - Amount to transfer
/// * `pool_bump` - PDA bump for signing
pub fn execute_vault_to_reserve_transfer<'info>(
    from_vault: &Account<'info, TokenAccount>,
    to_reserve: &Account<'info, TokenAccount>,
    pool: &AccountInfo<'info>,
    token_program: &Program<'info, Token>,
    amount: u64,
    pool_bump: u8,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    let pool_seeds = &[constants::POOL_SEED, &[pool_bump]];
    let signer_seeds = &[&pool_seeds[..]];

    let transfer_ctx = CpiContext::new_with_signer(
        token_program.to_account_info(),
        Transfer {
            from: from_vault.to_account_info(),
            to: to_reserve.to_account_info(),
            authority: pool.clone(),
        },
        signer_seeds,
    );
    token::transfer(transfer_ctx, amount)?;

    msg!("Transferred {} tokens: vault → reserve", amount);
    Ok(())
}

/// Execute a transfer from reserve to vault (fulfilling external liquidity)
pub fn execute_reserve_to_vault_transfer<'info>(
    from_reserve: &Account<'info, TokenAccount>,
    to_vault: &Account<'info, TokenAccount>,
    pool: &AccountInfo<'info>,
    token_program: &Program<'info, Token>,
    amount: u64,
    pool_bump: u8,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    let pool_seeds = &[constants::POOL_SEED, &[pool_bump]];
    let signer_seeds = &[&pool_seeds[..]];

    let transfer_ctx = CpiContext::new_with_signer(
        token_program.to_account_info(),
        Transfer {
            from: from_reserve.to_account_info(),
            to: to_vault.to_account_info(),
            authority: pool.clone(),
        },
        signer_seeds,
    );
    token::transfer(transfer_ctx, amount)?;

    msg!("Transferred {} tokens: reserve → vault", amount);
    Ok(())
}

#[arcium_program]
pub mod shuffle_protocol {
    use super::*;
    use crate::instructions;

    // =========================================================================
    // PROTOCOL INITIALIZATION (Phase 3)
    // =========================================================================

    /// Initialize the Shuffle Protocol protocol.
    /// Creates the Pool account and all token vaults.
    /// Should only be called once when deploying the protocol.
    ///
    /// # Arguments
    /// * `execution_fee_bps` - Fee on swaps in basis points (e.g., 50 = 0.5%)
    /// * `execution_trigger_count` - Number of orders to trigger batch execution
    pub fn initialize(
        ctx: Context<Initialize>,
        execution_fee_bps: u16,
        execution_trigger_count: u8,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, execution_fee_bps, execution_trigger_count)
    }

    // =========================================================================
    // USER ACCOUNT CREATION (Phase 4)
    // =========================================================================

    /// Create a new privacy account for the user.
    /// Each wallet can have only one privacy account.
    ///
    /// # Arguments
    /// * `user_pubkey` - User's x25519 public key for Arcium encryption
    /// * `initial_balances` - Encrypted balances for all 4 assets [USDC, TSLA, SPY, AAPL]
    /// * `initial_nonce` - Nonce used to encrypt the initial balances
    pub fn create_user_account(
        ctx: Context<CreateUserAccount>,
        user_pubkey: [u8; 32],
        initial_balances: [[u8; 32]; 4],
        initial_nonce: u128,
    ) -> Result<()> {
        instructions::create_user_account::handler(
            ctx,
            user_pubkey,
            initial_balances,
            initial_nonce,
        )
    }

    // =========================================================================
    // DEPOSIT (Phase 5 - REMOVED)
    // =========================================================================
    // Legacy plaintext deposit removed in Phase 6.
    // Use add_balance instruction for encrypted deposits via Arcium MPC.

    // =========================================================================
    // BATCH ACCUMULATOR INITIALIZATION (Phase 8)
    // =========================================================================

    /// Initialize the BatchAccumulator singleton account.
    /// This must be called once after pool initialization before orders can be placed.
    /// The BatchAccumulator tracks all orders across the 6 trading pairs.
    /// It auto-triggers batch execution when order_count >= 8 AND active_pairs >= 2.
    pub fn init_batch_accumulator(ctx: Context<InitBatchAccumulator>) -> Result<()> {
        instructions::init_batch_accumulator::handler(ctx)
    }

    // =========================================================================
    // PLACE ORDER (Phase 8)
    // =========================================================================

    /// Place an encrypted order in the current batch.
    /// Order details (pair_id, direction, amount) are encrypted on-chain.
    /// Only batch aggregates are revealed during execution.
    ///
    /// # Arguments
    /// * `computation_offset` - Unique ID for MPC computation
    /// * `encrypted_pair_id` - Trading pair (0-5) encrypted with user's key
    /// * `encrypted_direction` - Order direction (0=A_to_B, 1=B_to_A) encrypted
    /// * `encrypted_amount` - Order amount encrypted
    /// * `pubkey` - User's x25519 public key
    /// * `nonce` - Encryption nonce
    /// * `source_asset_id` - Plaintext hint for which asset is sold
    pub fn place_order(
        ctx: Context<PlaceOrder>,
        computation_offset: u64,
        encrypted_pair_id: [u8; 32],
        encrypted_direction: [u8; 32],
        encrypted_amount: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
        source_asset_id: u8,
    ) -> Result<()> {
        instructions::place_order::handler(
            ctx,
            computation_offset,
            encrypted_pair_id,
            encrypted_direction,
            encrypted_amount,
            pubkey,
            nonce,
            source_asset_id,
        )
    }

    /// Callback handler for accumulate_order computation.
    /// Receives (has_funds, new_balance, new_batch_state) from MPC.
    /// If has_funds is false, clears pending_order and aborts.
    /// Callback handler for accumulate_order computation.
    /// MPC output is now a 4-tuple: (has_funds, batch_ready, new_balance, new_batch_state)
    /// - has_funds: revealed bool - if false, clear pending_order and abort
    /// - batch_ready: revealed bool - if true, emit BatchReadyEvent
    /// - new_balance: Enc<Shared, UserBalance> - updated user balance
    /// - new_batch_state: Enc<Mxe, BatchState> - updated batch with order/pair tracking
    #[arcium_callback(encrypted_ix = "accumulate_order")]
    pub fn accumulate_order_callback(
        ctx: Context<AccumulateOrderCallback>,
        output: SignedComputationOutputs<AccumulateOrderOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(output) => output,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        // MPC output is a 4-tuple: (has_funds, batch_ready, new_balance, new_batch_state)
        // Wrapped as: o.field_0 = tuple containing all four
        // o.field_0.field_0 = bool (has_funds, revealed)
        // o.field_0.field_1 = bool (batch_ready, revealed)
        // o.field_0.field_2 = UserBalance (SharedEncryptedStruct<1>)
        // o.field_0.field_3 = BatchState (MXEEncryptedStruct - now includes order_count + active_pairs)

        let has_funds: bool = o.field_0.field_0;
        let batch_ready: bool = o.field_0.field_1;

        // If user doesn't have sufficient funds, clear pending_order and abort
        if !has_funds {
            msg!("Order rejected: insufficient balance");
            ctx.accounts.user_account.pending_order = None;
            return Err(ErrorCode::InsufficientBalance.into());
        }

        // Update user's balance for the source asset
        let asset_id = ctx.accounts.user_account.pending_asset_id;
        let old_nonce = ctx.accounts.user_account.get_nonce(asset_id);
        let new_nonce = o.field_0.field_2.nonce;
        let new_ciphertext = o.field_0.field_2.ciphertexts[0];

        msg!(
            "DEBUG: Updating balance for asset_id={}, old_nonce={}, new_nonce={}, ciphertext[0..4]={:?}",
            asset_id,
            old_nonce,
            new_nonce,
            &new_ciphertext[0..4]
        );

        ctx.accounts
            .user_account
            .set_credit(asset_id, new_ciphertext);
        ctx.accounts.user_account.set_nonce(asset_id, new_nonce);

        // Update batch accumulator with new encrypted batch state from MPC
        // Ciphertext layout: 12 values (6 pairs × 2 totals each)

        // Capture key before mutable borrow (for event emission later)
        let batch_accumulator_key = ctx.accounts.batch_accumulator.key();
        let batch = &mut ctx.accounts.batch_accumulator;

        // Store pair totals (12 ciphertexts)
        for pair_id in 0..6 {
            batch.pair_states[pair_id].encrypted_token_a_in =
                o.field_0.field_3.ciphertexts[pair_id * 2];
            batch.pair_states[pair_id].encrypted_token_b_in =
                o.field_0.field_3.ciphertexts[pair_id * 2 + 1];
        }

        // Increment plaintext order_count if order was successful
        if has_funds {
            batch.order_count += 1;
        }

        // Store MXE output nonce for subsequent reads (critical for reveal_batch)
        let old_mxe_nonce = batch.mxe_nonce;
        let new_mxe_nonce = o.field_0.field_3.nonce;
        batch.mxe_nonce = new_mxe_nonce;

        msg!(
            "DEBUG accumulate_order: old_mxe_nonce={}, new_mxe_nonce={}, batch_ready={}, order_count={}",
            old_mxe_nonce,
            new_mxe_nonce,
            batch_ready,
            batch.order_count
        );

        // Check batch_ready flag from MPC (requirements: >= 8 orders AND >= 2 pairs)
        if batch_ready {
            msg!("Batch ready for execution: MPC confirmed requirements met");

            // Emit BatchReadyEvent for external batch executor (webhook listener)
            emit!(BatchReadyEvent {
                batch_id: batch.batch_id,
                batch_accumulator: batch_accumulator_key,
            });
        }

        emit!(OrderPlacedEvent {
            user: ctx.accounts.user_account.owner,
            batch_id: batch.batch_id,
        });

        msg!(
            "Order callback: user={}, batch={}, batch_ready={}",
            ctx.accounts.user_account.owner,
            batch.batch_id,
            batch_ready
        );

        Ok(())
    }

    // =========================================================================
    // EXECUTE BATCH (Phase 9)
    // =========================================================================

    /// Execute the current batch.
    /// Reveals aggregate totals via MPC, then performs netting and swaps in callback.
    ///
    /// # Arguments
    /// * `computation_offset` - Unique ID for MPC computation
    pub fn execute_batch(ctx: Context<ExecuteBatch>, computation_offset: u64) -> Result<()> {
        instructions::execute_batch::handler(ctx, computation_offset)
    }

    /// Execute vault↔reserve swaps based on BatchLog netting results.
    /// Called by backend after MPC callback completes.
    ///
    /// # Arguments
    /// * `batch_id` - The batch ID to execute swaps for
    pub fn execute_swaps(ctx: Context<ExecuteSwaps>, batch_id: u64) -> Result<()> {
        instructions::execute_swaps::handler(ctx, batch_id)
    }

    /// Callback handler for reveal_batch computation.
    /// Receives plaintext totals and performs netting + swaps.
    #[arcium_callback(encrypted_ix = "reveal_batch")]
    pub fn reveal_batch_callback(
        ctx: Context<RevealBatchCallback>,
        output: SignedComputationOutputs<RevealBatchOutput>,
    ) -> Result<()> {
        // For reveal() outputs, access the array via the output struct
        let totals: [u64; 12] = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(RevealBatchOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        // DEBUG: Log the raw totals from MPC
        msg!(
            "DEBUG reveal_batch: totals = [{}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}]",
            totals[0],
            totals[1],
            totals[2],
            totals[3],
            totals[4],
            totals[5],
            totals[6],
            totals[7],
            totals[8],
            totals[9],
            totals[10],
            totals[11]
        );
        msg!(
            "DEBUG reveal_batch: batch_id={}, mxe_nonce={}",
            ctx.accounts.batch_accumulator.batch_id,
            ctx.accounts.batch_accumulator.mxe_nonce
        );

        // totals is [u64; 12] - 6 pairs × 2 values (a_in, b_in)
        use crate::state::PairResult;

        // Helper: Get asset IDs for a trading pair
        fn get_pair_tokens(pair_id: u8) -> (u8, u8) {
            match pair_id {
                0 => (1, 0), // TSLA/USDC
                1 => (2, 0), // SPY/USDC
                2 => (3, 0), // AAPL/USDC
                3 => (1, 2), // TSLA/SPY
                4 => (1, 3), // TSLA/AAPL
                5 => (2, 3), // SPY/AAPL
                _ => (0, 0),
            }
        }

        // Mock prices (in USDC, 6 decimals). Real implementation would use oracle.
        // USDC = $1.00, TSLA = $250, SPY = $450, AAPL = $180
        let prices = [1_000_000u64, 250_000_000u64, 450_000_000u64, 180_000_000u64];

        let mut pair_results = [PairResult::default(); 6];

        // Process each pair with netting algorithm
        // reveal() returns [u64; 12] - the array is the output directly
        // totals is type [u64; 12] from the MPC output
        for pair_id in 0..6 {
            let total_a_in = totals[pair_id * 2];
            let total_b_in = totals[pair_id * 2 + 1];

            // Skip inactive pairs
            if total_a_in == 0 && total_b_in == 0 {
                continue;
            }

            let (base_asset, quote_asset) = get_pair_tokens(pair_id as u8);

            // Convert both sides to common unit (quote asset value) for comparison
            let a_value_in_quote = (total_a_in as u128 * prices[base_asset as usize] as u128)
                / prices[quote_asset as usize] as u128;
            let b_value = total_b_in as u128;

            let (final_pool_a, final_pool_b) = if a_value_in_quote > b_value {
                // Net surplus on A side: users deposited more base_asset than needed
                // Transfer surplus from vault_A → reserve_A
                // Transfer equivalent from reserve_B → vault_B
                let surplus_in_a = ((a_value_in_quote - b_value)
                    * prices[quote_asset as usize] as u128)
                    / prices[base_asset as usize] as u128;

                // Calculate output (1% slippage for simulation)
                let amount_out = (surplus_in_a * 99) / 100;
                let surplus_capped = surplus_in_a.min(total_a_in as u128) as u64;

                msg!(
                    "Pair {}: Net surplus {} units of asset {} → swap for {} units of asset {}",
                    pair_id,
                    surplus_capped,
                    base_asset,
                    amount_out,
                    quote_asset
                );

                // TODO: Token transfers disabled for callback account limit testing
                // When re-enabled:
                // - Transfer surplus from vault_base → reserve_base
                // - Transfer output from reserve_quote → vault_quote

                (
                    total_a_in.saturating_sub(surplus_capped),
                    total_b_in.saturating_add(amount_out as u64),
                )
            } else if b_value > a_value_in_quote {
                // Net surplus on B side: users deposited more quote_asset than needed
                let surplus_in_b = b_value - a_value_in_quote;
                let amount_out = (surplus_in_b * 99) / 100;
                let surplus_capped = surplus_in_b.min(total_b_in as u128) as u64;

                msg!(
                    "Pair {}: Net surplus {} units of asset {} → swap for {} units of asset {}",
                    pair_id,
                    surplus_capped,
                    quote_asset,
                    amount_out,
                    base_asset
                );

                // TODO: Token transfers disabled for callback account limit testing
                // When re-enabled:
                // - Transfer surplus from vault_quote → reserve_quote
                // - Transfer output from reserve_base → vault_base

                (
                    total_a_in.saturating_add(amount_out as u64),
                    total_b_in.saturating_sub(surplus_capped),
                )
            } else {
                // Perfect internal match - no external swap needed
                msg!("Pair {}: Perfect internal match, no external swap", pair_id);
                (total_a_in, total_b_in)
            };

            pair_results[pair_id] = PairResult {
                total_a_in,
                total_b_in,
                final_pool_a,
                final_pool_b,
            };

            msg!(
                "Pair {}: total_a_in={}, total_b_in={}, final_pool_a={}, final_pool_b={}",
                pair_id,
                total_a_in,
                total_b_in,
                final_pool_a,
                final_pool_b
            );
        }

        // Update BatchLog (already initialized in execute_batch)
        let batch_log = &mut ctx.accounts.batch_log;
        batch_log.batch_id = ctx.accounts.batch_accumulator.batch_id;
        batch_log.results = pair_results;
        batch_log.executed_at = Clock::get()?.unix_timestamp;

        // Reset BatchAccumulator for next batch
        let batch = &mut ctx.accounts.batch_accumulator;
        let old_batch_id = batch.batch_id;
        batch.batch_id += 1;
        // Reset plaintext order_count for next batch
        batch.order_count = 0;

        msg!("Batch {} executed", old_batch_id);

        // Emit event for backend to trigger execute_swaps
        emit!(BatchExecutedEvent {
            batch_id: old_batch_id,
            batch_log: ctx.accounts.batch_log.key(),
        });

        Ok(())
    }

    // =========================================================================
    // SETTLE ORDER (Phase 10)
    // =========================================================================

    /// Settle a pending order.
    /// Calculates pro-rata payout based on batch results and user's order size.
    ///
    /// # Arguments
    /// * `computation_offset` - Unique ID for MPC computation
    /// * `pubkey` - User's x25519 public key
    /// * `nonce` - Encryption nonce
    /// * `pair_id` - Trading pair (0-5)
    /// * `direction` - Order direction (0=A_to_B, 1=B_to_A)
    pub fn settle_order(
        ctx: Context<SettleOrder>,
        computation_offset: u64,
        pubkey: [u8; 32],
        nonce: u128,
        pair_id: u8,
        direction: u8,
    ) -> Result<()> {
        instructions::settle_order::handler(
            ctx,
            computation_offset,
            pubkey,
            nonce,
            pair_id,
            direction,
        )
    }

    /// Callback handler for calculate_payout computation.
    /// Updates user balance with payout and clears pending_order.
    #[arcium_callback(encrypted_ix = "calculate_payout")]
    pub fn calculate_payout_callback(
        ctx: Context<CalculatePayoutCallback>,
        output: SignedComputationOutputs<CalculatePayoutOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(output) => output,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        // For tuple output (Enc<Shared, UserBalance>, u64):
        // o.field_0 = wrapper for first tuple element
        // o.field_0.field_0 = the actual Enc<Shared, UserBalance> with .ciphertexts and .nonce
        // o.field_1 = the revealed u64 payout (if accessible)

        // DEBUG: Try to log the revealed payout value
        // Note: If this doesn't compile, comment it out
        msg!(
            "DEBUG calculate_payout: revealed payout = {}",
            o.field_0.field_1
        );

        // Update output asset balance using o.field_0.field_0 (the encrypted UserBalance)
        let output_asset_id = ctx.accounts.user_account.pending_asset_id;
        ctx.accounts
            .user_account
            .set_credit(output_asset_id, o.field_0.field_0.ciphertexts[0]);
        ctx.accounts
            .user_account
            .set_nonce(output_asset_id, o.field_0.field_0.nonce);

        // Clear pending_order
        let batch_id = ctx.accounts.user_account.pending_order.unwrap().batch_id;
        ctx.accounts.user_account.pending_order = None;

        emit!(SettlementEvent {
            user: ctx.accounts.user_account.owner,
            batch_id,
            encrypted_payout: o.field_0.field_0.ciphertexts[0],
            nonce: o.field_0.field_0.nonce.to_le_bytes(),
            revealed_payout: o.field_0.field_1,
        });

        msg!(
            "Settlement callback: user={}, batch={}, payout={}",
            ctx.accounts.user_account.owner,
            batch_id,
            o.field_0.field_1
        );

        Ok(())
    }

    // =========================================================================
    // LIQUIDITY MANAGEMENT (Protocol Reserves)
    // =========================================================================

    /// Add liquidity to protocol reserves.
    /// Only callable by pool authority.
    ///
    /// # Arguments
    /// * `asset_id` - Asset to add (0=USDC, 1=TSLA, 2=SPY, 3=AAPL)
    /// * `amount` - Amount to transfer to reserves
    pub fn add_liquidity(ctx: Context<AddLiquidity>, asset_id: u8, amount: u64) -> Result<()> {
        instructions::add_liquidity::handler(ctx, asset_id, amount)
    }

    /// Remove liquidity from protocol reserves.
    /// Only callable by pool authority.
    ///
    /// # Arguments
    /// * `asset_id` - Asset to remove (0=USDC, 1=TSLA, 2=SPY, 3=AAPL)
    /// * `amount` - Amount to transfer from reserves
    pub fn remove_liquidity(
        ctx: Context<RemoveLiquidity>,
        asset_id: u8,
        amount: u64,
    ) -> Result<()> {
        instructions::remove_liquidity::handler(ctx, asset_id, amount)
    }

    // =========================================================================
    // FAUCET (Devnet only)
    // =========================================================================

    /// Claim USDC from the devnet faucet.
    /// Each user can claim up to 1000 USDC total.
    ///
    /// # Arguments
    /// * `amount` - Amount of USDC to claim (in base units, 6 decimals)
    pub fn faucet(ctx: Context<Faucet>, amount: u64) -> Result<()> {
        instructions::faucet::handler(ctx, amount)
    }

    // =========================================================================
    // ARCIUM MPC SETUP (Demo - from scaffolding)
    // =========================================================================

    pub fn init_add_together_comp_def(ctx: Context<InitAddTogetherCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    // =========================================================================
    // ARCIUM MPC SETUP - Add Balance (Phase 6)
    // =========================================================================

    /// Initialize the add_balance computation definition.
    /// This must be called once before any encrypted deposits can be processed.
    pub fn init_add_balance_comp_def(ctx: Context<InitAddBalanceCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    /// Initialize the accumulate_order computation definition (Phase 8).
    /// This must be called once before orders can be placed.
    pub fn init_accumulate_order_comp_def(ctx: Context<InitAccumulateOrderCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    /// Initialize the init_batch_state computation definition (Phase 8).
    /// This must be called once for batch initialization.
    pub fn init_init_batch_state_comp_def(ctx: Context<InitInitBatchStateCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    /// Initialize the reveal_batch computation definition (Phase 9).
    /// This must be called once before batch execution.
    pub fn init_reveal_batch_comp_def(ctx: Context<InitRevealBatchCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    /// Initialize the calculate_payout computation definition (Phase 10).
    /// This must be called once before settlements can be processed.
    pub fn init_calculate_payout_comp_def(ctx: Context<InitCalculatePayoutCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    // =========================================================================
    // INIT_BATCH_STATE - Initialize batch accumulator with encrypted zeros
    // =========================================================================
    // This MUST be called after initBatchAccumulator and before any orders.
    // The MPC generates properly encrypted zeros that can be decrypted later.

    /// Queue MPC to generate encrypted zeros for the batch accumulator.
    /// This must be called once after batch accumulator creation and after each batch reset.
    pub fn init_batch_state(ctx: Context<InitBatchState>, computation_offset: u64) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // init_batch_state takes `mxe: Mxe` argument
        // The Mxe type compiles to a struct with a u128 nonce field
        let args = ArgBuilder::new()
            .plaintext_u128(0) // Mxe nonce placeholder
            .build();

        use arcium_client::idl::arcium::types::CallbackAccount;
        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![InitBatchStateCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.batch_accumulator.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;

        msg!("init_batch_state queued for MPC");
        Ok(())
    }

    /// Callback: Receive encrypted zeros from MPC and store in batch accumulator.
    /// BatchState has 19 encrypted u64 values:
    /// - pairs[6]: 12 u64 values (pair[i].total_a_in, pair[i].total_b_in) - indices 0-11
    /// - order_count: 1 u64 value - index 12
    /// - active_pairs[6]: 6 bool values (as u64s in MPC) - indices 13-18
    #[arcium_callback(encrypted_ix = "init_batch_state")]
    pub fn init_batch_state_callback(
        ctx: Context<InitBatchStateCallback>,
        output: SignedComputationOutputs<InitBatchStateOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(output) => output,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        // MPC output is MXEEncryptedStruct with 12 ciphertexts (6 pairs × 2 values)
        let batch = &mut ctx.accounts.batch_accumulator;

        // Store pair totals (12 ciphertexts)
        for pair_id in 0..6 {
            batch.pair_states[pair_id].encrypted_token_a_in = o.field_0.ciphertexts[pair_id * 2];
            batch.pair_states[pair_id].encrypted_token_b_in =
                o.field_0.ciphertexts[pair_id * 2 + 1];
        }

        // Store MXE output nonce for subsequent reads
        batch.mxe_nonce = o.field_0.nonce;

        msg!(
            "DEBUG init_batch_state: initial_mxe_nonce={}",
            batch.mxe_nonce
        );

        Ok(())
    }

    pub fn add_together(
        ctx: Context<AddTogether>,
        computation_offset: u64,
        ciphertext_0: [u8; 32],
        ciphertext_1: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u8(ciphertext_0)
            .encrypted_u8(ciphertext_1)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![AddTogetherCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "add_together")]
    pub fn add_together_callback(
        ctx: Context<AddTogetherCallback>,
        output: SignedComputationOutputs<AddTogetherOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(AddTogetherOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        emit!(SumEvent {
            sum: o.ciphertexts[0],
            nonce: o.nonce.to_le_bytes(),
        });
        Ok(())
    }

    // =========================================================================
    // ADD BALANCE - Queue Encrypted Deposit (Phase 6)
    // =========================================================================

    /// Queue an encrypted balance update for a deposit.
    /// This performs the token transfer and queues the MPC computation.
    /// The actual balance update happens in the callback.
    ///
    /// # Arguments
    /// * `computation_offset` - Unique ID for this computation
    /// * `encrypted_amount` - The deposit amount encrypted with user's key
    /// * `pubkey` - User's x25519 public key
    /// * `nonce` - Encryption nonce
    /// * `amount` - Plaintext amount for token transfer (revealed for CPI)
    /// * `asset_id` - Asset identifier (0=USDC, 1=TSLA, 2=SPY, 3=AAPL)
    pub fn add_balance(
        ctx: Context<AddBalance>,
        computation_offset: u64,
        encrypted_amount: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
        amount: u64,
        asset_id: u8,
    ) -> Result<()> {
        // Validate asset_id
        require!(asset_id <= 3, ErrorCode::InvalidAssetId);

        // Transfer tokens first (this is visible on-chain, but private in aggregate)
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        anchor_spl::token::transfer(transfer_ctx, amount)?;

        // Store pending asset_id for callback to know which balance to update
        ctx.accounts.user_account.pending_asset_id = asset_id;

        // Set sign PDA bump
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Build MPC arguments using the correct balance and nonce for this asset
        let current_balance = ctx.accounts.user_account.get_credit(asset_id);
        let current_nonce = ctx.accounts.user_account.get_nonce(asset_id);
        let args = ArgBuilder::new()
            // Shared input 1: BalanceUpdate (new deposit amount)
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(encrypted_amount)
            // Shared input 2: UserBalance (current balance from account)
            .x25519_pubkey(pubkey)
            .plaintext_u128(current_nonce)
            .encrypted_u64(current_balance)
            .build();

        // Register callback that will receive the new encrypted balance
        use arcium_client::idl::arcium::types::CallbackAccount;
        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![AddBalanceCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.user_account.key(),
                    is_writable: true,
                }],
            )?],
            1, // number of callbacks
            0, // priority
        )?;

        msg!(
            "Deposit queued: {} units of asset {}, computation {}",
            amount,
            asset_id,
            computation_offset
        );
        Ok(())
    }

    /// Callback handler for add_balance computation.
    /// Receives the new encrypted balance from MPC and updates user account.
    #[arcium_callback(encrypted_ix = "add_balance")]
    pub fn add_balance_callback(
        ctx: Context<AddBalanceCallback>,
        output: SignedComputationOutputs<AddBalanceOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(AddBalanceOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        // Update the correct asset balance and nonce using pending_asset_id set during add_balance
        let asset_id = ctx.accounts.user_account.pending_asset_id;

        ctx.accounts
            .user_account
            .set_credit(asset_id, o.ciphertexts[0]);
        ctx.accounts.user_account.set_nonce(asset_id, o.nonce);

        emit!(DepositEvent {
            user: ctx.accounts.user_account.owner,
            encrypted_balance: o.ciphertexts[0],
            nonce: o.nonce.to_le_bytes(),
        });

        msg!("Deposit callback: asset {} balance updated", asset_id);
        Ok(())
    }

    // =========================================================================
    // ARCIUM MPC SETUP - Sub Balance (Phase 6.5)
    // =========================================================================

    /// Initialize the sub_balance computation definition.
    /// This must be called once before any encrypted withdrawals can be processed.
    pub fn init_sub_balance_comp_def(ctx: Context<InitSubBalanceCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    // =========================================================================
    // SUB BALANCE - Queue Encrypted Withdrawal (Phase 6.5)
    // =========================================================================

    /// Queue an encrypted balance update for a withdrawal.
    /// This performs the token transfer and queues the MPC computation.
    /// The encrypted balance update happens in the callback.
    ///
    /// # Arguments
    /// * `computation_offset` - Unique ID for this computation
    /// * `encrypted_amount` - The withdrawal amount encrypted with user's key
    /// * `pubkey` - User's x25519 public key
    /// * `nonce` - Encryption nonce
    /// * `amount` - Plaintext amount for token transfer (deferred to callback)
    /// * `asset_id` - Asset identifier (0=USDC, 1=TSLA, 2=SPY, 3=AAPL)
    pub fn sub_balance(
        ctx: Context<SubBalance>,
        computation_offset: u64,
        encrypted_amount: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
        amount: u64,
        asset_id: u8,
    ) -> Result<()> {
        // Validate asset_id
        require!(asset_id <= 3, ErrorCode::InvalidAssetId);

        // Store pending info for callback to use
        // Token transfer is DEFERRED to callback (after MPC confirms sufficient balance)
        ctx.accounts.user_account.pending_asset_id = asset_id;
        ctx.accounts.user_account.pending_withdrawal_amount = amount;

        // Set sign PDA bump
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Build MPC arguments using the correct balance and nonce for this asset
        let current_balance = ctx.accounts.user_account.get_credit(asset_id);
        let current_nonce = ctx.accounts.user_account.get_nonce(asset_id);
        let args = ArgBuilder::new()
            // Shared input 1: BalanceUpdate (withdrawal amount)
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(encrypted_amount)
            // Shared input 2: UserBalance (current balance from account)
            .x25519_pubkey(pubkey)
            .plaintext_u128(current_nonce)
            .encrypted_u64(current_balance)
            .build();

        // Register callback that will verify has_funds and perform token transfer
        use arcium_client::idl::arcium::types::CallbackAccount;
        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![SubBalanceCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[
                    CallbackAccount {
                        pubkey: ctx.accounts.user_account.key(),
                        is_writable: true,
                    },
                    CallbackAccount {
                        pubkey: ctx.accounts.pool.key(),
                        is_writable: false,
                    },
                    CallbackAccount {
                        pubkey: ctx.accounts.vault.key(),
                        is_writable: true,
                    },
                    CallbackAccount {
                        pubkey: ctx.accounts.recipient_token_account.key(),
                        is_writable: true,
                    },
                    CallbackAccount {
                        pubkey: ctx.accounts.token_program.key(),
                        is_writable: false,
                    },
                ],
            )?],
            1, // number of callbacks
            0, // priority
        )?;

        msg!(
            "Withdrawal queued: {} units of asset {}, computation {} (transfer deferred to callback)",
            amount,
            asset_id,
            computation_offset
        );
        Ok(())
    }

    /// Callback handler for sub_balance computation.
    /// Receives (has_funds, new_balance) from MPC.
    /// If has_funds is false, aborts the transaction.
    /// If has_funds is true, performs the token transfer and updates balance.
    #[arcium_callback(encrypted_ix = "sub_balance")]
    pub fn sub_balance_callback(
        ctx: Context<SubBalanceCallback>,
        output: SignedComputationOutputs<SubBalanceOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(output) => output,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        // Extract has_funds flag from MPC output
        // Circuit returns (bool, Enc<Shared, UserBalance>) wrapped in field_0
        // o.field_0.field_0 = bool (has_funds, revealed)
        // o.field_0.field_1 = UserBalance (SharedEncryptedStruct<1>)
        let has_funds: bool = o.field_0.field_0;
        let new_balance = &o.field_0.field_1;

        // If user doesn't have sufficient funds, abort the transaction
        if !has_funds {
            return Err(ErrorCode::InsufficientBalance.into());
        }

        // Perform the deferred token transfer now that MPC confirmed sufficient balance
        let pool_seeds = &[POOL_SEED, &[ctx.accounts.pool.bump]];
        let signer_seeds = &[&pool_seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            signer_seeds,
        );

        let amount = ctx.accounts.user_account.pending_withdrawal_amount;
        anchor_spl::token::transfer(transfer_ctx, amount)?;

        // Update the correct asset balance and nonce
        let asset_id = ctx.accounts.user_account.pending_asset_id;
        ctx.accounts
            .user_account
            .set_credit(asset_id, new_balance.ciphertexts[0]);
        ctx.accounts
            .user_account
            .set_nonce(asset_id, new_balance.nonce);

        // Clear pending withdrawal
        ctx.accounts.user_account.pending_withdrawal_amount = 0;

        emit!(WithdrawEvent {
            user: ctx.accounts.user_account.owner,
            encrypted_balance: new_balance.ciphertexts[0],
            nonce: new_balance.nonce.to_le_bytes(),
        });

        msg!(
            "Withdrawal callback: {} units of asset {} transferred, balance updated",
            amount,
            asset_id
        );
        Ok(())
    }

    // =========================================================================
    // P2P INTERNAL TRANSFER (Phase 6.75)
    // =========================================================================

    /// Check if a wallet has a privacy account.
    /// This is a view function for clients to check before attempting transfers.
    ///
    /// # Returns
    /// * `true` if the account exists
    /// * `false` if the account doesn't exist
    pub fn check_privacy_account_exists(ctx: Context<CheckPrivacyAccountExists>) -> Result<bool> {
        // If we get here, the account exists (Anchor validates it)
        // So we just return true
        msg!(
            "Privacy account exists for wallet: {}",
            ctx.accounts.user_account.owner
        );
        Ok(true)
    }

    // =========================================================================
    // ARCIUM MPC SETUP - Transfer (Phase 6.75)
    // =========================================================================

    /// Initialize the transfer computation definition.
    /// This must be called once before any P2P transfers can be processed.
    pub fn init_transfer_comp_def(ctx: Context<InitTransferCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    // =========================================================================
    // P2P INTERNAL TRANSFER (Phase 6.75)
    // =========================================================================

    // =========================================================================
    // TEST SWAP CPI (Phase 8 - Cross-Program Invocation to mock_jupiter)
    // =========================================================================

    /// Test CPI swap through mock_jupiter.
    /// The Pool PDA signs the CPI as the "user_authority" since it owns the vaults.
    /// This proves cross-program invocation works before building full batch execution.
    ///
    /// # Arguments
    /// * `amount_in` - Amount of source tokens to swap
    /// * `min_amount_out` - Minimum acceptable output (slippage protection)
    pub fn test_swap(ctx: Context<TestSwap>, amount_in: u64, min_amount_out: u64) -> Result<()> {
        instructions::test_swap::handler(ctx, amount_in, min_amount_out)
    }

    // =========================================================================
    // P2P INTERNAL TRANSFER (Phase 6.75)
    // =========================================================================

    /// Internal transfer between two privacy accounts.
    /// Atomically deducts from sender's and adds to recipient's encrypted balance.
    ///
    /// Both balances are updated in a single MPC computation using the `transfer` circuit.
    ///
    /// # Arguments
    /// * `computation_offset` - Unique ID for MPC computation
    /// * `encrypted_amount` - Amount encrypted with sender's key
    /// * `pubkey` - Sender's x25519 public key
    /// * `nonce` - Encryption nonce
    pub fn internal_transfer(
        ctx: Context<InternalTransfer>,
        computation_offset: u64,
        encrypted_amount: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        // Set sign PDA bump
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Build MPC arguments for transfer circuit
        // Transfer circuit takes: TransferRequest { amount }, sender_balance, recipient_balance
        // All use Enc<Shared, *> pattern with x25519 pubkey + nonce + encrypted value
        let args = ArgBuilder::new()
            // TransferRequest (encrypted with sender's key) - just amount field
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(encrypted_amount)
            // Sender's current balance (Enc<Shared, *> - using sender's pubkey)
            .x25519_pubkey(ctx.accounts.sender_account.user_pubkey)
            .plaintext_u128(ctx.accounts.sender_account.usdc_nonce)
            .encrypted_u64(ctx.accounts.sender_account.usdc_credit)
            // Recipient's current balance (Enc<Shared, *> - using recipient's pubkey)
            .x25519_pubkey(ctx.accounts.recipient_account.user_pubkey)
            .plaintext_u128(ctx.accounts.recipient_account.usdc_nonce)
            .encrypted_u64(ctx.accounts.recipient_account.usdc_credit)
            .build();

        // Queue MPC - callback receives BOTH updated balances
        use arcium_client::idl::arcium::types::CallbackAccount;
        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![TransferCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[
                    CallbackAccount {
                        pubkey: ctx.accounts.sender_account.key(),
                        is_writable: true,
                    },
                    CallbackAccount {
                        pubkey: ctx.accounts.recipient_account.key(),
                        is_writable: true,
                    },
                ],
            )?],
            1,
            0,
        )?;

        msg!(
            "Transfer queued: {} -> {}, computation {}",
            ctx.accounts.sender_account.owner,
            ctx.accounts.recipient_account.owner,
            computation_offset
        );
        Ok(())
    }

    /// Callback handler for transfer computation.
    /// Receives both updated balances and writes them atomically.
    #[arcium_callback(encrypted_ix = "transfer")]
    pub fn transfer_callback(
        ctx: Context<TransferCallback>,
        output: SignedComputationOutputs<TransferOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(output) => output,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        // Tuple return creates nested struct:
        // o.field_0.field_0 = sender's new balance (Enc<Shared, UserBalance>)
        // o.field_0.field_1 = recipient's new balance (Enc<Shared, UserBalance>)

        // Log old values for debugging
        msg!(
            "DEBUG transfer_callback: sender old nonce={}, old credit[0..4]={:?}",
            ctx.accounts.sender_account.usdc_nonce,
            &ctx.accounts.sender_account.usdc_credit[0..4]
        );
        msg!(
            "DEBUG transfer_callback: recipient old nonce={}, old credit[0..4]={:?}",
            ctx.accounts.recipient_account.usdc_nonce,
            &ctx.accounts.recipient_account.usdc_credit[0..4]
        );

        // Log new values from MPC
        msg!(
            "DEBUG transfer_callback: sender new nonce={}, new credit[0..4]={:?}",
            o.field_0.field_0.nonce,
            &o.field_0.field_0.ciphertexts[0][0..4]
        );
        msg!(
            "DEBUG transfer_callback: recipient new nonce={}, new credit[0..4]={:?}",
            o.field_0.field_1.nonce,
            &o.field_0.field_1.ciphertexts[0][0..4]
        );

        // Update sender's encrypted balance and USDC nonce
        ctx.accounts.sender_account.usdc_credit = o.field_0.field_0.ciphertexts[0];
        ctx.accounts.sender_account.usdc_nonce = o.field_0.field_0.nonce;

        // Update recipient's encrypted balance and USDC nonce
        ctx.accounts.recipient_account.usdc_credit = o.field_0.field_1.ciphertexts[0];
        ctx.accounts.recipient_account.usdc_nonce = o.field_0.field_1.nonce;

        emit!(TransferEvent {
            from: ctx.accounts.sender_account.owner,
            to: ctx.accounts.recipient_account.owner,
            amount: 0, // Amount not revealed in callback
            sender_nonce: o.field_0.field_0.nonce.to_le_bytes(),
        });

        msg!(
            "Transfer callback: {} -> {} balances updated",
            ctx.accounts.sender_account.owner,
            ctx.accounts.recipient_account.owner
        );
        Ok(())
    }
}

#[queue_computation_accounts("add_together", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct AddTogether<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_ADD_TOGETHER)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,
    #[account(
        mut,
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS
    )]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("add_together")]
#[derive(Accounts)]
pub struct AddTogetherCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_ADD_TOGETHER)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account, checked by arcium program via constraints in the callback context.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
}

#[init_computation_definition_accounts("add_together", payer)]
#[derive(Accounts)]
pub struct InitAddTogetherCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    /// Can't check it here as it's not initialized yet.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// =============================================================================
// INIT ADD_BALANCE COMPUTATION DEFINITION (Phase 6)
// =============================================================================

#[init_computation_definition_accounts("add_balance", payer)]
#[derive(Accounts)]
pub struct InitAddBalanceCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    /// Can't check it here as it's not initialized yet.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// =============================================================================
// ADD BALANCE QUEUE COMPUTATION ACCOUNTS (Phase 6)
// =============================================================================
// These accounts are needed when calling add_balance instruction.
// Combines token transfer + MPC queue in single instruction.

#[queue_computation_accounts("add_balance", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct AddBalance<'info> {
    // =========================================================================
    // PAYER & USER
    // =========================================================================
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The user making the deposit (must sign for token transfer)
    #[account(mut)]
    pub user: Signer<'info>,

    // =========================================================================
    // TOKEN ACCOUNTS
    // =========================================================================
    /// The pool account (for vault authority)
    #[account(
        seeds = [POOL_SEED],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// User's privacy account (will have encrypted balance updated via callback)
    #[account(
        mut,
        seeds = [USER_SEED, user.key().as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Box<Account<'info, UserProfile>>,

    /// User's token account for the asset being deposited (source of funds)
    /// Caller must provide the correct token account matching the asset_id
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ ErrorCode::InvalidOwner,
    )]
    pub user_token_account: Box<Account<'info, anchor_spl::token::TokenAccount>>,

    /// Protocol's vault for the asset being deposited (destination of funds)
    /// Caller must provide the correct vault matching the asset_id
    #[account(mut)]
    pub vault: Box<Account<'info, anchor_spl::token::TokenAccount>>,

    pub token_program: Program<'info, anchor_spl::token::Token>,

    // =========================================================================
    // ARCIUM MPC ACCOUNTS
    // =========================================================================
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_ADD_BALANCE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,

    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,

    #[account(
        mut,
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS
    )]
    pub clock_account: Account<'info, ClockAccount>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

// =============================================================================
// ADD BALANCE CALLBACK ACCOUNTS (Phase 6)
// =============================================================================

#[callback_accounts("add_balance")]
#[derive(Accounts)]
pub struct AddBalanceCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_ADD_BALANCE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    /// CHECK: computation_account, checked by arcium program via constraints in the callback context.
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,

    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,

    /// User's privacy account - receives the updated encrypted balance
    #[account(mut)]
    pub user_account: Box<Account<'info, UserProfile>>,
}

#[event]
pub struct SumEvent {
    pub sum: [u8; 32],
    pub nonce: [u8; 16],
}

#[event]
pub struct DepositEvent {
    pub user: Pubkey,
    pub encrypted_balance: [u8; 32],
    pub nonce: [u8; 16],
}

#[event]
pub struct WithdrawEvent {
    pub user: Pubkey,
    pub encrypted_balance: [u8; 32],
    pub nonce: [u8; 16],
}

#[event]
pub struct TransferEvent {
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub sender_nonce: [u8; 16],
}

#[event]
pub struct OrderPlacedEvent {
    pub user: Pubkey,
    pub batch_id: u64,
}

#[event]
pub struct SettlementEvent {
    pub user: Pubkey,
    pub batch_id: u64,
    pub encrypted_payout: [u8; 32],
    pub nonce: [u8; 16],
    /// DEBUG: Revealed payout value from MPC for verification
    pub revealed_payout: u64,
}

/// Emitted when batch meets execution criteria (8+ orders, 2+ pairs)
/// MPC computes requirements check and reveals batch_ready boolean
/// Can be used by external services (webhooks) to trigger batch execution
#[event]
pub struct BatchReadyEvent {
    pub batch_id: u64,
    pub batch_accumulator: Pubkey,
}

/// Emitted when batch execution fails, signals retry needed
#[event]
pub struct BatchExecutionFailedEvent {
    pub batch_id: u64,
    pub error_code: u32,
}

/// Emitted when batch MPC completes and BatchLog is created
/// Backend listens for this to call execute_swaps
#[event]
pub struct BatchExecutedEvent {
    pub batch_id: u64,
    pub batch_log: Pubkey,
}

// =============================================================================
// CHECK PRIVACY ACCOUNT EXISTS (Phase 6.75)
// =============================================================================

/// Accounts for checking if a privacy account exists
#[derive(Accounts)]
pub struct CheckPrivacyAccountExists<'info> {
    /// The privacy account to check
    /// If this doesn't exist, Anchor will return AccountNotInitialized error
    pub user_account: Box<Account<'info, UserProfile>>,
}
// INIT SUB_BALANCE COMPUTATION DEFINITION (Phase 6.5)
// =============================================================================

#[init_computation_definition_accounts("sub_balance", payer)]
#[derive(Accounts)]
pub struct InitSubBalanceCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    /// Can't check it here as it's not initialized yet.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// =============================================================================
// INIT TRANSFER COMPUTATION DEFINITION (Phase 6.75)
// =============================================================================

#[init_computation_definition_accounts("transfer", payer)]
#[derive(Accounts)]
pub struct InitTransferCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// =============================================================================
// TRANSFER CALLBACK ACCOUNTS (Phase 6.75)
// =============================================================================
// Callback for transfer circuit - updates both sender and recipient balances.

#[callback_accounts("transfer")]
#[derive(Accounts)]
pub struct TransferCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_TRANSFER))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    /// CHECK: computation_account, checked by arcium program.
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,

    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,

    // Application accounts (passed via CallbackAccount)
    #[account(mut)]
    pub sender_account: Box<Account<'info, UserProfile>>,

    #[account(mut)]
    pub recipient_account: Box<Account<'info, UserProfile>>,
}

// =============================================================================
// SUB BALANCE QUEUE COMPUTATION ACCOUNTS (Phase 6.5)
// =============================================================================
// These accounts are needed when calling sub_balance instruction.
// Queues MPC computation; token transfer happens in callback.

#[queue_computation_accounts("sub_balance", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct SubBalance<'info> {
    // =========================================================================
    // PAYER & USER
    // =========================================================================
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The user making the withdrawal (must sign for authorization)
    #[account(mut)]
    pub user: Signer<'info>,

    // =========================================================================
    // TOKEN ACCOUNTS
    // =========================================================================
    /// The pool account (for vault authority in callback)
    #[account(
        seeds = [POOL_SEED],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// User's privacy account (will have encrypted balance updated via callback)
    #[account(
        mut,
        seeds = [USER_SEED, user.key().as_ref()],
        bump = user_account.bump,
        constraint = user_account.owner == user.key() @ ErrorCode::Unauthorized,
    )]
    pub user_account: Box<Account<'info, UserProfile>>,

    /// Recipient's token account for the asset being withdrawn (destination of funds)
    /// Can be the user's own account OR an external recipient's account
    /// Caller must provide the correct token account matching the asset_id
    #[account(mut)]
    pub recipient_token_account: Box<Account<'info, anchor_spl::token::TokenAccount>>,

    /// Protocol's vault for the asset being withdrawn (source of funds)
    /// Caller must provide the correct vault matching the asset_id
    #[account(mut)]
    pub vault: Box<Account<'info, anchor_spl::token::TokenAccount>>,

    pub token_program: Program<'info, anchor_spl::token::Token>,

    // =========================================================================
    // ARCIUM MPC ACCOUNTS
    // =========================================================================
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_SUB_BALANCE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,

    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,

    #[account(
        mut,
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS
    )]
    pub clock_account: Account<'info, ClockAccount>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

// =============================================================================
// SUB BALANCE CALLBACK ACCOUNTS (Phase 6.5)
// =============================================================================
// Callback receives MPC output, verifies has_funds, and performs token transfer.

#[callback_accounts("sub_balance")]
#[derive(Accounts)]
pub struct SubBalanceCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_SUB_BALANCE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    /// CHECK: computation_account, checked by arcium program via constraints in the callback context.
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,

    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,

    // =========================================================================
    // APPLICATION ACCOUNTS (passed via CallbackAccount)
    // =========================================================================
    /// User's privacy account - receives the updated encrypted balance
    #[account(mut)]
    pub user_account: Box<Account<'info, UserProfile>>,

    /// Pool PDA (authority for vault) - passed via CallbackAccount
    pub pool: Box<Account<'info, Pool>>,

    /// Vault token account - source of tokens for withdrawal
    /// CHECK: Passed via CallbackAccount, verified by token transfer
    #[account(mut)]
    pub vault: AccountInfo<'info>,

    /// Recipient token account - destination for withdrawn tokens
    /// CHECK: Passed via CallbackAccount, verified by token transfer
    #[account(mut)]
    pub recipient_token_account: AccountInfo<'info>,

    /// Token program for transfer CPI
    /// CHECK: Passed via CallbackAccount
    pub token_program: AccountInfo<'info>,
}

// =============================================================================
// INTERNAL TRANSFER ACCOUNTS (Phase 6.75)
// =============================================================================
// P2P transfer between two privacy accounts.

#[queue_computation_accounts("transfer", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct InternalTransfer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Sender must sign the transaction
    pub sender: Signer<'info>,

    /// Sender's privacy account (source of funds)
    #[account(
        mut,
        seeds = [USER_SEED, sender.key().as_ref()],
        bump,
        constraint = sender_account.owner == sender.key() @ ErrorCode::InvalidOwner,
    )]
    pub sender_account: Box<Account<'info, UserProfile>>,

    /// Recipient's privacy account (destination of funds)
    /// Must exist - if not initialized, Anchor will fail with AccountNotInitialized
    #[account(mut)]
    pub recipient_account: Box<Account<'info, UserProfile>>,

    // =========================================================================
    // ARCIUM MPC ACCOUNTS
    // =========================================================================
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: computation_account, will be initialized by arcium program.
    pub computation_account: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Box<Account<'info, Cluster>>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_TRANSFER))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,

    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,

    #[account(
        mut,
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS
    )]
    pub clock_account: Account<'info, ClockAccount>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

// =============================================================================
// INITIALIZE INSTRUCTION ACCOUNTS (Phase 3)
// =============================================================================
// This struct defines all accounts required for the initialize instruction.
// Defined here in lib.rs for Anchor's IDL generation to work correctly.
//

use crate::constants::*;
use crate::state::{BatchAccumulator, BatchLog, Pool, UserProfile};
use anchor_spl::token::Mint;

#[derive(Accounts)]
pub struct Initialize<'info> {
    // =========================================================================
    // PAYER & AUTHORITIES
    // =========================================================================
    /// The wallet paying for account creation (rent).
    /// Must sign the transaction.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Admin authority for the protocol.
    /// Can update fees, pause protocol, etc.
    /// CHECK: This can be any valid public key - stored as Pool.authority
    pub authority: UncheckedAccount<'info>,

    /// Operator wallet for batch execution.
    /// CHECK: This can be any valid public key - stored as Pool.operator
    pub operator: UncheckedAccount<'info>,

    /// Treasury wallet for collecting fees.
    /// CHECK: This can be any valid public key - stored as Pool.treasury
    pub treasury: UncheckedAccount<'info>,

    // =========================================================================
    // POOL ACCOUNT (PDA)
    // =========================================================================
    /// The main Pool account - central state for the protocol.
    /// PDA derived from seeds: ["pool"]
    /// Space calculation defined in Pool::SIZE
    /// Note: Wrapped in Box to reduce stack usage (many accounts in this instruction)
    #[account(
        init,
        payer = payer,
        space = Pool::SIZE,
        seeds = [POOL_SEED],
        bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    // =========================================================================
    // TOKEN MINTS (existing tokens on-chain)
    // =========================================================================
    /// USDC token mint - any valid mint can be passed
    /// The address is stored in Pool during initialization
    /// Note: Wrapped in Box to reduce stack usage
    pub usdc_mint: Box<Account<'info, Mint>>,

    /// TSLA token mint
    pub tsla_mint: Box<Account<'info, Mint>>,

    /// SPY token mint
    pub spy_mint: Box<Account<'info, Mint>>,

    /// AAPL token mint
    pub aapl_mint: Box<Account<'info, Mint>>,

    // =========================================================================
    // TOKEN VAULTS (PDAs)
    // =========================================================================
    // These are token accounts owned by the Pool PDA.
    // They hold the protocol's token balances.
    //

    // - `token::mint` specifies which token this account holds
    // - `token::authority` specifies who can transfer tokens (the Pool PDA)
    // - We use separate seeds for each vault to derive unique addresses
    /// USDC vault - holds all deposited USDC
    /// PDA seeds: ["vault", "usdc"]
    #[account(
        init,
        payer = payer,
        seeds = [VAULT_SEED, VAULT_USDC_SEED],
        bump,
        token::mint = usdc_mint,
        token::authority = pool,
    )]
    pub vault_usdc: Box<Account<'info, TokenAccount>>,

    /// TSLA vault - holds TSLA tokens
    /// PDA seeds: ["vault", "tsla"]
    #[account(
        init,
        payer = payer,
        seeds = [VAULT_SEED, VAULT_TSLA_SEED],
        bump,
        token::mint = tsla_mint,
        token::authority = pool,
    )]
    pub vault_tsla: Box<Account<'info, TokenAccount>>,

    /// SPY vault - holds SPY tokens
    /// PDA seeds: ["vault", "spy"]
    #[account(
        init,
        payer = payer,
        seeds = [VAULT_SEED, VAULT_SPY_SEED],
        bump,
        token::mint = spy_mint,
        token::authority = pool,
    )]
    pub vault_spy: Box<Account<'info, TokenAccount>>,

    /// AAPL vault - holds AAPL tokens
    /// PDA seeds: ["vault", "aapl"]
    #[account(
        init,
        payer = payer,
        seeds = [VAULT_SEED, VAULT_AAPL_SEED],
        bump,
        token::mint = aapl_mint,
        token::authority = pool,
    )]
    pub vault_aapl: Box<Account<'info, TokenAccount>>,

    // =========================================================================
    // RESERVE VAULTS (PDAs) - Protocol Liquidity
    // =========================================================================
    // These are token accounts for protocol-owned liquidity.
    // Used to fulfill net surplus during batch execution.
    // Separate from user deposit vaults above.
    /// USDC reserve - protocol liquidity for swaps
    /// PDA seeds: ["reserve", "usdc"]
    #[account(
        init,
        payer = payer,
        seeds = [RESERVE_SEED, RESERVE_USDC_SEED],
        bump,
        token::mint = usdc_mint,
        token::authority = pool,
    )]
    pub reserve_usdc: Box<Account<'info, TokenAccount>>,

    /// TSLA reserve - protocol liquidity
    /// PDA seeds: ["reserve", "tsla"]
    #[account(
        init,
        payer = payer,
        seeds = [RESERVE_SEED, RESERVE_TSLA_SEED],
        bump,
        token::mint = tsla_mint,
        token::authority = pool,
    )]
    pub reserve_tsla: Box<Account<'info, TokenAccount>>,

    /// SPY reserve - protocol liquidity
    /// PDA seeds: ["reserve", "spy"]
    #[account(
        init,
        payer = payer,
        seeds = [RESERVE_SEED, RESERVE_SPY_SEED],
        bump,
        token::mint = spy_mint,
        token::authority = pool,
    )]
    pub reserve_spy: Box<Account<'info, TokenAccount>>,

    /// AAPL reserve - protocol liquidity
    /// PDA seeds: ["reserve", "aapl"]
    #[account(
        init,
        payer = payer,
        seeds = [RESERVE_SEED, RESERVE_AAPL_SEED],
        bump,
        token::mint = aapl_mint,
        token::authority = pool,
    )]
    pub reserve_aapl: Box<Account<'info, TokenAccount>>,

    // =========================================================================
    // FAUCET VAULT (Devnet only)
    // =========================================================================
    /// USDC faucet vault - tokens users can claim for testing
    /// PDA seeds: ["faucet_usdc"]
    #[account(
        init,
        payer = payer,
        seeds = [FAUCET_VAULT_SEED],
        bump,
        token::mint = usdc_mint,
        token::authority = pool,
    )]
    pub faucet_vault: Box<Account<'info, TokenAccount>>,

    // =========================================================================
    // SYSTEM PROGRAMS
    // =========================================================================
    /// Required for creating accounts
    pub system_program: Program<'info, System>,

    /// Required for creating token accounts
    pub token_program: Program<'info, Token>,
}

// ErrorCode is now defined in errors.rs and re-exported above.
// It contains all error codes including AbortedComputation and ClusterNotSet.

// =============================================================================
// CREATE USER ACCOUNT INSTRUCTION ACCOUNTS (Phase 4)
// =============================================================================
// This struct defines all accounts required for the create_user_account instruction.
//

#[derive(Accounts)]
pub struct CreateUserAccount<'info> {
    /// The wallet paying for account creation (rent).
    /// Usually the same as owner, but can be different (sponsored).
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The wallet that will own this privacy account.
    /// Must sign to prove ownership.
    pub owner: Signer<'info>,

    /// The user's privacy account - PDA derived from their wallet address.
    /// Seeds: ["user", owner.key().as_ref()]
    /// This ensures only ONE privacy account per wallet.
    #[account(
        init,
        payer = payer,
        space = UserProfile::SIZE,
        seeds = [USER_SEED, owner.key().as_ref()],
        bump,
    )]
    pub user_account: Box<Account<'info, UserProfile>>,

    /// Required for creating accounts
    pub system_program: Program<'info, System>,
}

// Legacy Deposit struct removed in Phase 6.
// Use AddBalance for encrypted deposits via Arcium MPC.

// =============================================================================
// INIT BATCH ACCUMULATOR ACCOUNTS (Phase 8)
// =============================================================================
// Accounts for initializing the BatchAccumulator singleton.

#[derive(Accounts)]
pub struct InitBatchAccumulator<'info> {
    /// The payer for account creation.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The BatchAccumulator PDA to create.
    /// Seeds: ["batch_accumulator"]
    #[account(
        init,
        payer = payer,
        space = BatchAccumulator::SIZE,
        seeds = [BATCH_ACCUMULATOR_SEED],
        bump,
    )]
    pub batch_accumulator: Account<'info, BatchAccumulator>,

    pub system_program: Program<'info, System>,
}

// =============================================================================
// TEST SWAP CPI ACCOUNTS (Phase 8)
// =============================================================================
// Accounts for CPI call from shuffle_protocol to mock_jupiter's `swap` instruction.
// The Pool PDA acts as user_authority since it owns the source/dest vaults.
//

#[derive(Accounts)]
pub struct TestSwap<'info> {
    /// Operator triggers swaps (authorized backend service)
    #[account(
        constraint = operator.key() == pool.operator @ ErrorCode::Unauthorized,
    )]
    pub operator: Signer<'info>,

    /// Pool PDA - acts as signer for the CPI and owns the shuffle_protocol vaults.
    /// Must be mut because mock_jupiter's Swap marks user_authority as mut,
    /// and Solana requires writable privilege to be present in the outer instruction.
    #[account(
        mut,
        seeds = [POOL_SEED],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// Source token mint (e.g., USDC)
    pub source_mint: Box<Account<'info, Mint>>,

    /// Destination token mint (e.g., TSLA)
    pub destination_mint: Box<Account<'info, Mint>>,

    /// Shuffle Protocol vault for source asset (Pool PDA is authority).
    /// Tokens are sent FROM here to mock_jupiter.
    #[account(
        mut,
        token::mint = source_mint,
        token::authority = pool,
    )]
    pub pool_source_vault: Box<Account<'info, TokenAccount>>,

    /// Shuffle Protocol vault for destination asset (Pool PDA is authority).
    /// Tokens are received INTO here from mock_jupiter.
    #[account(
        mut,
        token::mint = destination_mint,
        token::authority = pool,
    )]
    pub pool_dest_vault: Box<Account<'info, TokenAccount>>,

    /// mock_jupiter program to CPI into
    /// CHECK: Validated by the instruction handler (program ID check optional for test)
    pub jupiter_program: UncheckedAccount<'info>,

    /// mock_jupiter swap_pool PDA
    /// CHECK: Validated by mock_jupiter program during CPI
    #[account(mut)]
    pub jupiter_swap_pool: UncheckedAccount<'info>,

    /// mock_jupiter source vault (receives source tokens from our pool)
    /// CHECK: Validated by mock_jupiter program during CPI
    #[account(mut)]
    pub jupiter_source_vault: UncheckedAccount<'info>,

    /// mock_jupiter destination vault (sends dest tokens to our pool)
    /// CHECK: Validated by mock_jupiter program during CPI
    #[account(mut)]
    pub jupiter_dest_vault: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

// =============================================================================
// PLACE ORDER ACCOUNTS (Phase 8)
// =============================================================================
// Queue computation to place an encrypted order in the batch.

#[queue_computation_accounts("accumulate_order", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct PlaceOrder<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// User placing the order
    #[account(mut)]
    pub user: Signer<'info>,

    /// User's privacy account
    #[account(
        mut,
        seeds = [USER_SEED, user.key().as_ref()],
        bump = user_account.bump,
        constraint = user_account.owner == user.key() @ ErrorCode::InvalidOwner,
        constraint = user_account.pending_order.is_none() @ ErrorCode::PendingOrderExists,
    )]
    pub user_account: Box<Account<'info, UserProfile>>,

    /// Batch accumulator singleton
    #[account(
        mut,
        seeds = [BATCH_ACCUMULATOR_SEED],
        bump = batch_accumulator.bump,
    )]
    pub batch_accumulator: Box<Account<'info, BatchAccumulator>>,

    // =========================================================================
    // ARCIUM MPC ACCOUNTS
    // =========================================================================
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_ACCUMULATE_ORDER))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,

    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,

    #[account(
        mut,
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS
    )]
    pub clock_account: Account<'info, ClockAccount>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

// =============================================================================
// PLACE ORDER CALLBACK ACCOUNTS (Phase 8)
// =============================================================================

#[callback_accounts("accumulate_order")]
#[derive(Accounts)]
pub struct AccumulateOrderCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_ACCUMULATE_ORDER))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    /// CHECK: computation_account, checked by arcium program.
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,

    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,

    // Application accounts (passed via CallbackAccount)
    #[account(mut)]
    pub user_account: Box<Account<'info, UserProfile>>,

    #[account(mut)]
    pub batch_accumulator: Box<Account<'info, BatchAccumulator>>,
}

// =============================================================================
// EXECUTE BATCH ACCOUNTS (Phase 9)
// =============================================================================

#[queue_computation_accounts("reveal_batch", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct ExecuteBatch<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Caller triggering batch execution (can be anyone now - permissionless)
    /// NOTE: In production, you may want to add incentives for the executor
    pub caller: Signer<'info>,

    /// Pool account for operator verification
    #[account(
        seeds = [POOL_SEED],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// Batch accumulator to read state from
    #[account(
        mut,
        seeds = [BATCH_ACCUMULATOR_SEED],
        bump = batch_accumulator.bump,
    )]
    pub batch_accumulator: Box<Account<'info, BatchAccumulator>>,

    /// BatchLog PDA to create (will be initialized in callback)
    #[account(
        init,
        payer = payer,
        space = BatchLog::SIZE,
        seeds = [BATCH_LOG_SEED, &batch_accumulator.batch_id.to_le_bytes()],
        bump,
    )]
    pub batch_log: Box<Account<'info, BatchLog>>,

    // =========================================================================
    // ARCIUM MPC ACCOUNTS
    // =========================================================================
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Box<Account<'info, ArciumSignerAccount>>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_REVEAL_BATCH))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,

    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Box<Account<'info, Cluster>>,

    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Box<Account<'info, FeePool>>,

    #[account(
        mut,
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS
    )]
    pub clock_account: Box<Account<'info, ClockAccount>>,

    // =========================================================================
    // VAULT & RESERVE ACCOUNTS (for token transfers in callback)
    // =========================================================================
    /// USDC vault (user deposits)
    #[account(
        mut,
        seeds = [VAULT_SEED, VAULT_USDC_SEED],
        bump,
    )]
    pub vault_usdc: Box<Account<'info, TokenAccount>>,

    /// TSLA vault
    #[account(
        mut,
        seeds = [VAULT_SEED, VAULT_TSLA_SEED],
        bump,
    )]
    pub vault_tsla: Box<Account<'info, TokenAccount>>,

    /// SPY vault
    #[account(
        mut,
        seeds = [VAULT_SEED, VAULT_SPY_SEED],
        bump,
    )]
    pub vault_spy: Box<Account<'info, TokenAccount>>,

    /// AAPL vault
    #[account(
        mut,
        seeds = [VAULT_SEED, VAULT_AAPL_SEED],
        bump,
    )]
    pub vault_aapl: Box<Account<'info, TokenAccount>>,

    /// USDC reserve (protocol liquidity)
    #[account(
        mut,
        seeds = [RESERVE_SEED, RESERVE_USDC_SEED],
        bump,
    )]
    pub reserve_usdc: Box<Account<'info, TokenAccount>>,

    /// TSLA reserve
    #[account(
        mut,
        seeds = [RESERVE_SEED, RESERVE_TSLA_SEED],
        bump,
    )]
    pub reserve_tsla: Box<Account<'info, TokenAccount>>,

    /// SPY reserve
    #[account(
        mut,
        seeds = [RESERVE_SEED, RESERVE_SPY_SEED],
        bump,
    )]
    pub reserve_spy: Box<Account<'info, TokenAccount>>,

    /// AAPL reserve
    #[account(
        mut,
        seeds = [RESERVE_SEED, RESERVE_AAPL_SEED],
        bump,
    )]
    pub reserve_aapl: Box<Account<'info, TokenAccount>>,

    /// Token program for transfers
    pub token_program: Program<'info, Token>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

// =============================================================================
// REVEAL BATCH CALLBACK ACCOUNTS (Phase 9)
// =============================================================================

#[callback_accounts("reveal_batch")]
#[derive(Accounts)]
pub struct RevealBatchCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_REVEAL_BATCH))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    /// CHECK: computation_account, checked by arcium program.
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,

    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,

    // Application accounts (passed via CallbackAccount)
    #[account(mut)]
    pub batch_accumulator: Box<Account<'info, BatchAccumulator>>,

    #[account(mut)]
    pub batch_log: Account<'info, BatchLog>,
    // TODO: Re-add these accounts after testing callback limit
    // pub pool: Box<Account<'info, Pool>>,
    // pub vault_usdc: Box<Account<'info, TokenAccount>>,
    // pub vault_tsla: Box<Account<'info, TokenAccount>>,
    // pub vault_spy: Box<Account<'info, TokenAccount>>,
    // pub vault_aapl: Box<Account<'info, TokenAccount>>,
    // pub reserve_usdc: Box<Account<'info, TokenAccount>>,
    // pub reserve_tsla: Box<Account<'info, TokenAccount>>,
    // pub reserve_spy: Box<Account<'info, TokenAccount>>,
    // pub reserve_aapl: Box<Account<'info, TokenAccount>>,
    // pub token_program: Program<'info, Token>,
}

// =============================================================================
// EXECUTE SWAPS ACCOUNTS (Phase 9.5)
// =============================================================================

#[derive(Accounts)]
#[instruction(batch_id: u64)]
pub struct ExecuteSwaps<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Operator authorized to trigger swaps (same as batch execution)
    #[account(
        constraint = operator.key() == pool.operator @ ErrorCode::Unauthorized,
    )]
    pub operator: Signer<'info>,

    /// Pool account for operator verification and PDA authority
    #[account(
        seeds = [POOL_SEED],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// BatchLog containing netting results (must be for matching batch_id)
    #[account(
        mut,
        seeds = [BATCH_LOG_SEED, &batch_id.to_le_bytes()],
        bump,
    )]
    pub batch_log: Account<'info, BatchLog>,

    // =========================================================================
    // VAULT ACCOUNTS (user deposits)
    // =========================================================================
    #[account(
        mut,
        seeds = [VAULT_SEED, VAULT_USDC_SEED],
        bump,
    )]
    pub vault_usdc: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [VAULT_SEED, VAULT_TSLA_SEED],
        bump,
    )]
    pub vault_tsla: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [VAULT_SEED, VAULT_SPY_SEED],
        bump,
    )]
    pub vault_spy: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [VAULT_SEED, VAULT_AAPL_SEED],
        bump,
    )]
    pub vault_aapl: Box<Account<'info, TokenAccount>>,

    // =========================================================================
    // RESERVE ACCOUNTS (protocol liquidity)
    // =========================================================================
    #[account(
        mut,
        seeds = [RESERVE_SEED, RESERVE_USDC_SEED],
        bump,
    )]
    pub reserve_usdc: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [RESERVE_SEED, RESERVE_TSLA_SEED],
        bump,
    )]
    pub reserve_tsla: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [RESERVE_SEED, RESERVE_SPY_SEED],
        bump,
    )]
    pub reserve_spy: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [RESERVE_SEED, RESERVE_AAPL_SEED],
        bump,
    )]
    pub reserve_aapl: Box<Account<'info, TokenAccount>>,

    /// Token program for transfers
    pub token_program: Program<'info, Token>,

    pub system_program: Program<'info, System>,
}

// =============================================================================
// SETTLE ORDER ACCOUNTS (Phase 10)
// =============================================================================

#[queue_computation_accounts("calculate_payout", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, pubkey: [u8; 32], nonce: u128, pair_id: u8, direction: u8)]
pub struct SettleOrder<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// User settling the order
    pub user: Signer<'info>,

    /// User's privacy account
    #[account(
        mut,
        seeds = [USER_SEED, user.key().as_ref()],
        bump = user_account.bump,
        constraint = user_account.owner == user.key() @ ErrorCode::InvalidOwner,
        constraint = user_account.pending_order.is_some() @ ErrorCode::NoPendingOrder,
    )]
    pub user_account: Box<Account<'info, UserProfile>>,

    /// BatchLog for the batch being settled
    #[account(
        seeds = [BATCH_LOG_SEED, &user_account.pending_order.unwrap().batch_id.to_le_bytes()],
        bump,
    )]
    pub batch_log: Account<'info, BatchLog>,

    // =========================================================================
    // ARCIUM MPC ACCOUNTS
    // =========================================================================
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CALCULATE_PAYOUT))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,

    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,

    #[account(
        mut,
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS
    )]
    pub clock_account: Account<'info, ClockAccount>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

// =============================================================================
// CALCULATE PAYOUT CALLBACK ACCOUNTS (Phase 10)
// =============================================================================

#[callback_accounts("calculate_payout")]
#[derive(Accounts)]
pub struct CalculatePayoutCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CALCULATE_PAYOUT))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    /// CHECK: computation_account, checked by arcium program.
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,

    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,

    // Application accounts (passed via CallbackAccount)
    #[account(mut)]
    pub user_account: Box<Account<'info, UserProfile>>,
}

// =============================================================================
// LIQUIDITY MANAGEMENT ACCOUNTS (Protocol Reserves)
// =============================================================================

#[derive(Accounts)]
#[instruction(asset_id: u8)]
pub struct AddLiquidity<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [POOL_SEED],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    /// Authority's token account (source of funds)
    #[account(mut)]
    pub authority_token_account: Account<'info, TokenAccount>,

    /// Reserve vault for the specified asset (destination)
    #[account(mut)]
    pub reserve_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(asset_id: u8)]
pub struct RemoveLiquidity<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [POOL_SEED],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    /// Authority's token account (destination)
    #[account(mut)]
    pub authority_token_account: Account<'info, TokenAccount>,

    /// Reserve vault for the specified asset (source)
    #[account(mut)]
    pub reserve_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// =============================================================================
// INIT ACCUMULATE_ORDER COMPUTATION DEFINITION (Phase 8)
// =============================================================================

#[init_computation_definition_accounts("accumulate_order", payer)]
#[derive(Accounts)]
pub struct InitAccumulateOrderCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// =============================================================================
// INIT INIT_BATCH_STATE COMPUTATION DEFINITION (Phase 8)
// =============================================================================

#[init_computation_definition_accounts("init_batch_state", payer)]
#[derive(Accounts)]
pub struct InitInitBatchStateCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// =============================================================================
// INIT_BATCH_STATE QUEUE ACCOUNTS
// =============================================================================

#[queue_computation_accounts("init_batch_state", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct InitBatchState<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Batch accumulator to initialize
    #[account(
        mut,
        seeds = [BATCH_ACCUMULATOR_SEED],
        bump = batch_accumulator.bump,
    )]
    pub batch_accumulator: Box<Account<'info, BatchAccumulator>>,

    // =========================================================================
    // ARCIUM MPC ACCOUNTS
    // =========================================================================
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Box<Account<'info, ArciumSignerAccount>>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_BATCH_STATE))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,

    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Box<Account<'info, Cluster>>,

    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Box<Account<'info, FeePool>>,

    #[account(
        mut,
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS
    )]
    pub clock_account: Box<Account<'info, ClockAccount>>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// =============================================================================
// INIT_BATCH_STATE CALLBACK ACCOUNTS
// =============================================================================

#[callback_accounts("init_batch_state")]
#[derive(Accounts)]
pub struct InitBatchStateCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_BATCH_STATE)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account, checked by arcium program via constraints in the callback context.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,

    /// Batch accumulator to update with encrypted zeros
    #[account(
        mut,
        seeds = [BATCH_ACCUMULATOR_SEED],
        bump = batch_accumulator.bump,
    )]
    pub batch_accumulator: Box<Account<'info, BatchAccumulator>>,
}

// =============================================================================
// INIT REVEAL_BATCH COMPUTATION DEFINITION (Phase 9)
// =============================================================================

#[init_computation_definition_accounts("reveal_batch", payer)]
#[derive(Accounts)]
pub struct InitRevealBatchCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// =============================================================================
// INIT CALCULATE_PAYOUT COMPUTATION DEFINITION (Phase 10)
// =============================================================================

#[init_computation_definition_accounts("calculate_payout", payer)]
#[derive(Accounts)]
pub struct InitCalculatePayoutCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// =============================================================================
// FAUCET ACCOUNTS (Devnet Faucet)
// =============================================================================
// Accounts for the faucet instruction that lets users claim free USDC.

#[derive(Accounts)]
pub struct Faucet<'info> {
    /// User claiming from faucet (must sign)
    pub user: Signer<'info>,

    /// User's privacy account (tracks total claimed)
    #[account(
        mut,
        seeds = [USER_SEED, user.key().as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Box<Account<'info, UserProfile>>,

    /// User's USDC token account (receives tokens)
    #[account(
        mut,
        constraint = user_usdc_account.owner == user.key() @ ErrorCode::InvalidOwner,
        constraint = user_usdc_account.mint == pool.usdc_mint @ ErrorCode::InvalidMint,
    )]
    pub user_usdc_account: Box<Account<'info, TokenAccount>>,

    /// Pool PDA (authority for vaults)
    #[account(
        seeds = [POOL_SEED],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// Faucet USDC vault (source of tokens)
    #[account(
        mut,
        seeds = [FAUCET_VAULT_SEED],
        bump,
        token::mint = pool.usdc_mint,
        token::authority = pool,
    )]
    pub faucet_vault: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}
