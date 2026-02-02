//! Execute Swaps Instruction
//!
//! Called by backend after MPC callback completes.
//! Reads BatchLog results and executes vault↔reserve token transfers.

use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::*;
use crate::errors::ErrorCode;
use crate::state::{BatchLog, Pool};
use crate::ExecuteSwaps;

/// Execute vault↔reserve swaps based on BatchLog netting results.
///
/// This instruction is called by the backend after the MPC reveal_batch callback
/// has written results to BatchLog. It performs the actual token transfers
/// to balance the protocol's liquidity between vaults (user deposits) and
/// reserves (protocol liquidity for external swaps).
///
/// The BatchLog contains:
/// - total_a_in, total_b_in: What users deposited
/// - final_pool_a, final_pool_b: The settled amounts after netting
///
/// Transfer logic:
/// - delta = final_pool - total_in
/// - If delta > 0: reserve → vault (protocol provides liquidity)
/// - If delta < 0: vault → reserve (protocol receives surplus)
///
/// # Arguments
/// * `batch_id` - The batch ID to execute swaps for (for verification)
pub fn handler(ctx: Context<ExecuteSwaps>, batch_id: u64) -> Result<()> {
    // Verify batch_id matches
    require!(
        ctx.accounts.batch_log.batch_id == batch_id,
        ErrorCode::InvalidBatchId
    );

    // Verify swaps haven't already been executed
    require!(
        !ctx.accounts.batch_log.swaps_executed,
        ErrorCode::SwapsAlreadyExecuted
    );

    let pool_bump = ctx.accounts.pool.bump;
    let pair_results = &ctx.accounts.batch_log.results;

    // Helper: Get asset IDs for a trading pair
    // Returns (base_asset, quote_asset)
    fn get_pair_tokens(pair_id: usize) -> (u8, u8) {
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

    // Process each pair using pre-computed results from BatchLog
    for pair_id in 0..6 {
        let result = &pair_results[pair_id];

        // Skip pairs with no activity
        if result.total_a_in == 0 && result.total_b_in == 0 {
            continue;
        }

        let (base_asset, quote_asset) = get_pair_tokens(pair_id);

        // Calculate deltas: what needs to move between vault and reserve
        // delta = final_pool - total_in
        // Positive delta = reserve provides to vault
        // Negative delta = vault provides to reserve

        let delta_a = result.final_pool_a as i128 - result.total_a_in as i128;
        let delta_b = result.final_pool_b as i128 - result.total_b_in as i128;

        msg!(
            "ExecuteSwaps: Pair {} - total_a_in={}, final_pool_a={}, delta_a={}",
            pair_id,
            result.total_a_in,
            result.final_pool_a,
            delta_a
        );
        msg!(
            "ExecuteSwaps: Pair {} - total_b_in={}, final_pool_b={}, delta_b={}",
            pair_id,
            result.total_b_in,
            result.final_pool_b,
            delta_b
        );

        // Execute transfer for base asset (A)
        if delta_a > 0 {
            // Protocol provides: reserve → vault
            let amount = delta_a as u64;
            msg!(
                "ExecuteSwaps: Pair {} - reserve→vault {} of asset {}",
                pair_id,
                amount,
                base_asset
            );
            execute_reserve_to_vault_by_asset(&ctx, base_asset, amount, pool_bump)?;
        } else if delta_a < 0 {
            // Protocol receives: vault → reserve
            let amount = (-delta_a) as u64;
            msg!(
                "ExecuteSwaps: Pair {} - vault→reserve {} of asset {}",
                pair_id,
                amount,
                base_asset
            );
            execute_vault_to_reserve_by_asset(&ctx, base_asset, amount, pool_bump)?;
        }

        // Execute transfer for quote asset (B)
        if delta_b > 0 {
            // Protocol provides: reserve → vault
            let amount = delta_b as u64;
            msg!(
                "ExecuteSwaps: Pair {} - reserve→vault {} of asset {}",
                pair_id,
                amount,
                quote_asset
            );
            execute_reserve_to_vault_by_asset(&ctx, quote_asset, amount, pool_bump)?;
        } else if delta_b < 0 {
            // Protocol receives: vault → reserve
            let amount = (-delta_b) as u64;
            msg!(
                "ExecuteSwaps: Pair {} - vault→reserve {} of asset {}",
                pair_id,
                amount,
                quote_asset
            );
            execute_vault_to_reserve_by_asset(&ctx, quote_asset, amount, pool_bump)?;
        }
    }

    // Mark swaps as executed
    ctx.accounts.batch_log.swaps_executed = true;

    msg!(
        "Swaps executed for batch {}: vault↔reserve transfers complete",
        batch_id
    );

    Ok(())
}

/// Helper: Execute vault → reserve transfer based on asset ID
fn execute_vault_to_reserve_by_asset(
    ctx: &Context<ExecuteSwaps>,
    asset_id: u8,
    amount: u64,
    pool_bump: u8,
) -> Result<()> {
    match asset_id {
        0 => crate::execute_vault_to_reserve_transfer(
            &ctx.accounts.vault_usdc,
            &ctx.accounts.reserve_usdc,
            &ctx.accounts.pool.to_account_info(),
            &ctx.accounts.token_program,
            amount,
            pool_bump,
        ),
        1 => crate::execute_vault_to_reserve_transfer(
            &ctx.accounts.vault_tsla,
            &ctx.accounts.reserve_tsla,
            &ctx.accounts.pool.to_account_info(),
            &ctx.accounts.token_program,
            amount,
            pool_bump,
        ),
        2 => crate::execute_vault_to_reserve_transfer(
            &ctx.accounts.vault_spy,
            &ctx.accounts.reserve_spy,
            &ctx.accounts.pool.to_account_info(),
            &ctx.accounts.token_program,
            amount,
            pool_bump,
        ),
        3 => crate::execute_vault_to_reserve_transfer(
            &ctx.accounts.vault_aapl,
            &ctx.accounts.reserve_aapl,
            &ctx.accounts.pool.to_account_info(),
            &ctx.accounts.token_program,
            amount,
            pool_bump,
        ),
        _ => Ok(()),
    }
}

/// Helper: Execute reserve → vault transfer based on asset ID
fn execute_reserve_to_vault_by_asset(
    ctx: &Context<ExecuteSwaps>,
    asset_id: u8,
    amount: u64,
    pool_bump: u8,
) -> Result<()> {
    match asset_id {
        0 => crate::execute_reserve_to_vault_transfer(
            &ctx.accounts.reserve_usdc,
            &ctx.accounts.vault_usdc,
            &ctx.accounts.pool.to_account_info(),
            &ctx.accounts.token_program,
            amount,
            pool_bump,
        ),
        1 => crate::execute_reserve_to_vault_transfer(
            &ctx.accounts.reserve_tsla,
            &ctx.accounts.vault_tsla,
            &ctx.accounts.pool.to_account_info(),
            &ctx.accounts.token_program,
            amount,
            pool_bump,
        ),
        2 => crate::execute_reserve_to_vault_transfer(
            &ctx.accounts.reserve_spy,
            &ctx.accounts.vault_spy,
            &ctx.accounts.pool.to_account_info(),
            &ctx.accounts.token_program,
            amount,
            pool_bump,
        ),
        3 => crate::execute_reserve_to_vault_transfer(
            &ctx.accounts.reserve_aapl,
            &ctx.accounts.vault_aapl,
            &ctx.accounts.pool.to_account_info(),
            &ctx.accounts.token_program,
            amount,
            pool_bump,
        ),
        _ => Ok(()),
    }
}
