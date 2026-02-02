use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};

use crate::constants::POOL_SEED;
use crate::errors::ErrorCode;
use crate::RemoveLiquidity;

// =============================================================================
// REMOVE LIQUIDITY - Admin instruction to withdraw tokens from protocol reserves
// =============================================================================
// Allows the protocol authority to withdraw tokens from reserve vaults.

/// Remove liquidity from protocol reserves.
/// Only callable by the pool authority (admin).
///
/// # Arguments
/// * `asset_id` - Asset to remove (0=USDC, 1=TSLA, 2=SPY, 3=AAPL)
/// * `amount` - Amount to transfer from reserves
pub fn handler(ctx: Context<RemoveLiquidity>, asset_id: u8, amount: u64) -> Result<()> {
    // Validate asset_id
    require!(asset_id <= 3, ErrorCode::InvalidAssetId);

    // Validate caller is authority
    require!(
        ctx.accounts.authority.key() == ctx.accounts.pool.authority,
        ErrorCode::Unauthorized
    );

    // Pool PDA signs the transfer from reserve vault
    let pool_seeds = &[POOL_SEED, &[ctx.accounts.pool.bump]];
    let signer_seeds = &[&pool_seeds[..]];

    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.reserve_vault.to_account_info(),
            to: ctx.accounts.authority_token_account.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(transfer_ctx, amount)?;

    msg!(
        "Removed {} units of asset {} from reserves",
        amount,
        asset_id
    );
    Ok(())
}
