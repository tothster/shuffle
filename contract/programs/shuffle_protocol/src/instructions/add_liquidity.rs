use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};

use crate::errors::ErrorCode;
use crate::AddLiquidity;

// =============================================================================
// ADD LIQUIDITY - Admin instruction to add tokens to protocol reserves
// =============================================================================
// Allows the protocol authority to deposit tokens into reserve vaults.
// These reserves are used to fulfill net surplus during batch execution.

/// Add liquidity to protocol reserves.
/// Only callable by the pool authority (admin).
///
/// # Arguments
/// * `asset_id` - Asset to add (0=USDC, 1=TSLA, 2=SPY, 3=AAPL)
/// * `amount` - Amount to transfer to reserves
pub fn handler(ctx: Context<AddLiquidity>, asset_id: u8, amount: u64) -> Result<()> {
    // Validate asset_id
    require!(asset_id <= 3, ErrorCode::InvalidAssetId);

    // Validate caller is authority
    require!(
        ctx.accounts.authority.key() == ctx.accounts.pool.authority,
        ErrorCode::Unauthorized
    );

    // Transfer tokens from authority's token account to reserve vault
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.authority_token_account.to_account_info(),
            to: ctx.accounts.reserve_vault.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, amount)?;

    msg!(
        "Added {} units of asset {} to reserves",
        amount,
        asset_id
    );
    Ok(())
}
