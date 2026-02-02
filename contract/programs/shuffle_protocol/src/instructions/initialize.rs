use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::ErrorCode;
use crate::Initialize;

// =============================================================================
// INITIALIZE INSTRUCTION HANDLER
// =============================================================================
// This handler sets up the protocol by configuring the Pool account.
// The account validation (including vault creation) is defined in lib.rs.
//

/// Initialize the Shuffle Protocol protocol.
///
/// # Arguments
/// * `ctx` - The validated accounts context
/// * `execution_fee_bps` - Fee charged on swaps in basis points (e.g., 50 = 0.5%)
/// * `execution_trigger_count` - Number of orders to trigger batch execution (default: 8)
pub fn handler(
    ctx: Context<Initialize>,
    execution_fee_bps: u16,
    execution_trigger_count: u8,
) -> Result<()> {
    // Validate inputs
    // The fee cannot exceed 10% (1000 basis points) to protect users
    require!(execution_fee_bps <= MAX_FEE_BPS, ErrorCode::FeeTooHigh);

    // Get the Pool account and set its initial state
    let pool = &mut ctx.accounts.pool;

    // Store the bump seed - used later when the Pool PDA needs to sign transactions
    // (e.g., when transferring tokens from vaults during batch execution)
    pool.bump = ctx.bumps.pool;

    // Set the admin authority - this wallet can:
    // - Update fees
    // - Pause/unpause the protocol
    // - Change operator/treasury
    pool.authority = ctx.accounts.authority.key();

    // Set the operator - this wallet can:
    // - Trigger batch execution
    // - Usually an automated backend service
    pool.operator = ctx.accounts.operator.key();

    // Set the treasury - where execution fees are sent
    pool.treasury = ctx.accounts.treasury.key();

    // Store mint addresses - these can be different per environment
    // (localnet uses test mints, devnet/mainnet use real mints)
    // New architecture: USDC, TSLA, SPY, AAPL (4 assets → 6 pairs)
    pool.usdc_mint = ctx.accounts.usdc_mint.key();
    pool.tsla_mint = ctx.accounts.tsla_mint.key();
    pool.spy_mint = ctx.accounts.spy_mint.key();
    pool.aapl_mint = ctx.accounts.aapl_mint.key();

    // Batch configuration
    pool.current_batch_id = 0;
    pool.execution_trigger_count = execution_trigger_count;

    // Set fee configuration
    pool.execution_fee_bps = execution_fee_bps;

    // Initialize state
    pool.paused = false;
    pool.total_fees_collected = 0;
    pool.total_batches_executed = 0;

    msg!("Shuffle Protocol protocol initialized!");
    msg!("Authority: {}", pool.authority);
    msg!("Operator: {}", pool.operator);
    msg!("USDC mint: {}", pool.usdc_mint);
    msg!("TSLA mint: {}", pool.tsla_mint);
    msg!("SPY mint: {}", pool.spy_mint);
    msg!("AAPL mint: {}", pool.aapl_mint);
    msg!("Execution fee: {} bps", pool.execution_fee_bps);
    msg!("Batch trigger at {} orders", pool.execution_trigger_count);

    Ok(())
}
