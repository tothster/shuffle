use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};

use crate::constants::*;
use crate::errors::ErrorCode;
use crate::Faucet;

/// Claim USDC from the devnet faucet.
/// Each user can claim up to FAUCET_MAX_PER_USER (1000 USDC) total.
///
/// # Arguments
/// * `ctx` - Validated accounts context
/// * `amount` - Amount of USDC to claim (in base units, 6 decimals)
pub fn handler(ctx: Context<Faucet>, amount: u64) -> Result<()> {
    // Validate amount
    require!(amount > 0, ErrorCode::InvalidAmount);

    // Check user hasn't exceeded their limit
    let user = &mut ctx.accounts.user_account;
    let new_total = user
        .total_faucet_claimed
        .checked_add(amount)
        .ok_or(ErrorCode::InvalidAmount)?;

    require!(
        new_total <= FAUCET_MAX_PER_USER,
        ErrorCode::FaucetLimitExceeded
    );

    // Transfer USDC from faucet vault to user's token account
    let pool_seeds = &[POOL_SEED, &[ctx.accounts.pool.bump]];
    let signer_seeds = &[&pool_seeds[..]];

    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.faucet_vault.to_account_info(),
            to: ctx.accounts.user_usdc_account.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(transfer_ctx, amount)?;

    // Update user's total claimed
    user.total_faucet_claimed = new_total;

    msg!(
        "Faucet: {} USDC claimed by {}. Total claimed: {} / {}",
        amount,
        user.owner,
        new_total,
        FAUCET_MAX_PER_USER
    );

    Ok(())
}
