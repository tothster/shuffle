use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

use crate::constants::POOL_SEED;
use crate::TestSwap;

/// Handler for test_swap instruction.
/// Performs a CPI call to mock_jupiter's `swap` instruction.
pub fn handler(ctx: Context<TestSwap>, amount_in: u64, min_amount_out: u64) -> Result<()> {
    let pool = &ctx.accounts.pool;

    // =========================================================================
    // Step 1: Anchor instruction discriminator for "swap"
    // =========================================================================
    // sha256("global:swap")[0..8] = f8c69e91e17587c8
    // Pre-computed to avoid runtime hash dependency.
    let discriminator: [u8; 8] = [0xf8, 0xc6, 0x9e, 0x91, 0xe1, 0x75, 0x87, 0xc8];

    // =========================================================================
    // Step 2: Serialize instruction data
    // =========================================================================
    // Layout: [8-byte discriminator][8-byte amount_in LE][8-byte min_amount_out LE]
    let mut data = Vec::with_capacity(8 + 8 + 8);
    data.extend_from_slice(&discriminator);
    data.extend_from_slice(&amount_in.to_le_bytes());
    data.extend_from_slice(&min_amount_out.to_le_bytes());

    // =========================================================================
    // Step 3: Build account metas matching mock_jupiter's Swap struct order
    // =========================================================================
    // mock_jupiter::Swap expects:
    //   1. user_authority (signer, mut) -> our Pool PDA signs via invoke_signed
    //   2. swap_pool (mut)
    //   3. source_mint
    //   4. destination_mint
    //   5. user_source_token (mut) -> our pool_source_vault (Pool PDA is authority)
    //   6. user_destination_token (mut) -> our pool_dest_vault
    //   7. pool_source_vault (mut) -> jupiter's source vault
    //   8. pool_destination_vault (mut) -> jupiter's dest vault
    //   9. token_program
    let accounts = vec![
        AccountMeta::new(pool.key(), true), // user_authority (Pool PDA signs)
        AccountMeta::new(ctx.accounts.jupiter_swap_pool.key(), false), // swap_pool
        AccountMeta::new_readonly(ctx.accounts.source_mint.key(), false), // source_mint
        AccountMeta::new_readonly(ctx.accounts.destination_mint.key(), false), // destination_mint
        AccountMeta::new(ctx.accounts.pool_source_vault.key(), false), // user_source_token (our vault)
        AccountMeta::new(ctx.accounts.pool_dest_vault.key(), false), // user_destination_token (our vault)
        AccountMeta::new(ctx.accounts.jupiter_source_vault.key(), false), // pool_source_vault (jupiter's)
        AccountMeta::new(ctx.accounts.jupiter_dest_vault.key(), false), // pool_destination_vault (jupiter's)
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false), // token_program
    ];

    let ix = Instruction {
        program_id: ctx.accounts.jupiter_program.key(),
        accounts,
        data,
    };

    // =========================================================================
    // Step 4: invoke_signed with Pool PDA seeds
    // =========================================================================
    // The Pool PDA signs this CPI so mock_jupiter sees it as the "user_authority".
    let pool_seeds = &[POOL_SEED, &[pool.bump]];
    let signer_seeds = &[&pool_seeds[..]];

    invoke_signed(
        &ix,
        &[
            ctx.accounts.pool.to_account_info(),
            ctx.accounts.jupiter_swap_pool.to_account_info(),
            ctx.accounts.source_mint.to_account_info(),
            ctx.accounts.destination_mint.to_account_info(),
            ctx.accounts.pool_source_vault.to_account_info(),
            ctx.accounts.pool_dest_vault.to_account_info(),
            ctx.accounts.jupiter_source_vault.to_account_info(),
            ctx.accounts.jupiter_dest_vault.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ],
        signer_seeds,
    )?;

    msg!(
        "CPI swap completed: {} in, {} min out",
        amount_in,
        min_amount_out
    );

    Ok(())
}
