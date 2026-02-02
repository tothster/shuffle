use anchor_lang::prelude::*;

use crate::CreateUserAccount;

// =============================================================================
// CREATE USER ACCOUNT INSTRUCTION HANDLER
// =============================================================================
// This handler creates a new UserProfile for a user.
// The account validation and creation is defined in lib.rs (CreateUserAccount struct).
//
// Key change: User must provide an encrypted zero balance for USDC.
// Since we use Enc<Shared, *> for all user data, the client encrypts with
// their shared secret and provides the initial ciphertext and nonce.

/// Create a new privacy account (UserProfile) for the user.
///
/// # Arguments
/// * `ctx` - The validated accounts context
/// * `user_pubkey` - User's x25519 public key for encryption/decryption
/// * `initial_balances` - Encrypted balances for all 4 assets [USDC, TSLA, SPY, AAPL] (should be encrypted 0)
/// * `initial_nonce` - Nonce used to encrypt the initial balances
///
/// # Notes
/// - Client must encrypt `{balance: 0}` with their cipher for each asset
/// - This ensures the circuit can properly decrypt on first deposit
pub fn handler(
    ctx: Context<CreateUserAccount>,
    user_pubkey: [u8; 32],
    initial_balances: [[u8; 32]; 4],
    initial_nonce: u128,
) -> Result<()> {
    // Get the user account and initialize its fields
    let user_account = &mut ctx.accounts.user_account;

    // Store the PDA bump - used for signing in future instructions
    user_account.bump = ctx.bumps.user_account;

    // Set the owner to the signer's wallet address
    user_account.owner = ctx.accounts.owner.key();

    // Store the x25519 public key for Arcium encryption
    user_account.user_pubkey = user_pubkey;

    // Initialize all assets with user-encrypted zero balances
    // This allows add_balance to properly decrypt on first deposit
    user_account.usdc_credit = initial_balances[0];
    user_account.tsla_credit = initial_balances[1];
    user_account.spy_credit = initial_balances[2];
    user_account.aapl_credit = initial_balances[3];

    // Viewable balances (not used currently - all zeros)
    user_account.usdc_viewable = [0u8; 32];
    user_account.tsla_viewable = [0u8; 32];
    user_account.spy_viewable = [0u8; 32];
    user_account.aapl_viewable = [0u8; 32];

    // No pending order initially
    user_account.pending_order = None;
    user_account.pending_asset_id = 0;

    // Initialize per-asset nonces - all assets use the same initial nonce
    user_account.usdc_nonce = initial_nonce;
    user_account.tsla_nonce = initial_nonce;
    user_account.spy_nonce = initial_nonce;
    user_account.aapl_nonce = initial_nonce;

    user_account.order_count = 0;
    user_account.total_faucet_claimed = 0;

    msg!("Privacy account created for user: {}", user_account.owner);
    msg!(
        "All asset balances initialized with nonce: {}",
        initial_nonce
    );

    Ok(())
}
