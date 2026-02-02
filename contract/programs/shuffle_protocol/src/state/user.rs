use anchor_lang::prelude::*;

// =============================================================================
// USER PROFILE & ORDER TICKET
// =============================================================================
// Each user has ONE UserProfile storing encrypted balances across 4 assets
// and an optional pending order (OrderTicket).
//
// Assets: USDC, TSLA, SPY, AAPL (4 assets → 6 trading pairs)
//

/// An embedded order record stored in UserProfile.
/// Replaces the separate Order PDA accounts from the previous architecture.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct OrderTicket {
    /// Which batch this order belongs to
    pub batch_id: u64,

    /// Encrypted pair ID (0-5) - hidden on-chain
    pub pair_id: [u8; 32],

    /// Encrypted direction: A_to_B (0) or B_to_A (1)
    pub direction: [u8; 32],

    /// Encrypted order amount
    pub encrypted_amount: [u8; 32],

    /// Nonce used for encryption (needed for user to decrypt order)
    pub order_nonce: u128,
}

impl OrderTicket {
    /// Size in bytes: 8 + 32 + 32 + 32 + 16 = 120
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 16;
}

/// Per-user account that stores encrypted balances for all 4 assets.
/// The balances are encrypted using Arcium MPC, so on-chain observers
/// cannot see actual amounts.
///
/// PDA derived with seeds: ["user", user_wallet.key().as_ref()]
#[account]
pub struct UserProfile {
    /// The wallet that owns this profile.
    pub owner: Pubkey,

    /// User's x25519 public key for encryption/decryption.
    /// Used by Arcium MPC to encrypt values that only this user can decrypt.
    pub user_pubkey: [u8; 32],

    // =========================================================================
    // ENCRYPTED BALANCES (private - only user can decrypt)
    // =========================================================================
    /// Encrypted USDC balance (ciphertext).
    pub usdc_credit: [u8; 32],

    /// Encrypted TSLA (tokenized Tesla) balance.
    pub tsla_credit: [u8; 32],

    /// Encrypted SPY (tokenized S&P 500 ETF) balance.
    pub spy_credit: [u8; 32],

    /// Encrypted AAPL (tokenized Apple) balance.
    pub aapl_credit: [u8; 32],

    // =========================================================================
    // VIEWABLE BALANCES (re-encrypted for frontend display)
    // =========================================================================
    // These are encrypted with a shared key that the frontend can decrypt
    // for UI display, while keeping on-chain values hidden.
    pub usdc_viewable: [u8; 32],
    pub tsla_viewable: [u8; 32],
    pub spy_viewable: [u8; 32],
    pub aapl_viewable: [u8; 32],

    /// Current pending order awaiting settlement.
    /// Only one order per user at a time. Must settle before placing new order.
    /// None means no pending order.
    pub pending_order: Option<OrderTicket>,

    /// Asset ID for pending MPC operation (0=USDC, 1=TSLA, 2=SPY, 3=AAPL).
    /// Set during add_balance/sub_balance, read in callback to update correct balance.
    pub pending_asset_id: u8,

    /// Pending withdrawal amount (in token units).
    /// Set during sub_balance, used by callback for deferred token transfer.
    pub pending_withdrawal_amount: u64,

    // =========================================================================
    // PER-ASSET NONCES - Each asset tracks its own encryption nonce
    // =========================================================================
    /// USDC encryption nonce - updated after each USDC MPC operation
    pub usdc_nonce: u128,
    /// TSLA encryption nonce
    pub tsla_nonce: u128,
    /// SPY encryption nonce
    pub spy_nonce: u128,
    /// AAPL encryption nonce
    pub aapl_nonce: u128,

    /// Total number of orders ever created by this user.
    pub order_count: u64,

    /// Total USDC claimed from faucet (tracked to enforce per-user limit).
    pub total_faucet_claimed: u64,

    /// PDA bump seed.
    pub bump: u8,
}

impl UserProfile {
    /// Asset ID constants
    pub const ASSET_USDC: u8 = 0;
    pub const ASSET_TSLA: u8 = 1;
    pub const ASSET_SPY: u8 = 2;
    pub const ASSET_AAPL: u8 = 3;

    /// Size of the UserProfile in bytes.
    pub const SIZE: usize = 8 + // discriminator
        32 +  // owner
        32 +  // user_pubkey
        32 +  // usdc_credit
        32 +  // tsla_credit
        32 +  // spy_credit
        32 +  // aapl_credit
        32 +  // usdc_viewable
        32 +  // tsla_viewable
        32 +  // spy_viewable
        32 +  // aapl_viewable
        1 + OrderTicket::SIZE + // pending_order (Option)
        1 +   // pending_asset_id
        8 +   // pending_withdrawal_amount
        16 +  // usdc_nonce (u128)
        16 +  // tsla_nonce (u128)
        16 +  // spy_nonce (u128)
        16 +  // aapl_nonce (u128)
        8 +   // order_count
        8 +   // total_faucet_claimed
        1; // bump

    /// Get the encrypted balance for a given asset ID
    pub fn get_credit(&self, asset_id: u8) -> [u8; 32] {
        match asset_id {
            Self::ASSET_USDC => self.usdc_credit,
            Self::ASSET_TSLA => self.tsla_credit,
            Self::ASSET_SPY => self.spy_credit,
            Self::ASSET_AAPL => self.aapl_credit,
            _ => self.usdc_credit,
        }
    }

    /// Set the encrypted balance for a given asset ID
    pub fn set_credit(&mut self, asset_id: u8, balance: [u8; 32]) {
        match asset_id {
            Self::ASSET_USDC => self.usdc_credit = balance,
            Self::ASSET_TSLA => self.tsla_credit = balance,
            Self::ASSET_SPY => self.spy_credit = balance,
            Self::ASSET_AAPL => self.aapl_credit = balance,
            _ => self.usdc_credit = balance,
        }
    }

    /// Get the nonce for a given asset ID
    pub fn get_nonce(&self, asset_id: u8) -> u128 {
        match asset_id {
            Self::ASSET_USDC => self.usdc_nonce,
            Self::ASSET_TSLA => self.tsla_nonce,
            Self::ASSET_SPY => self.spy_nonce,
            Self::ASSET_AAPL => self.aapl_nonce,
            _ => self.usdc_nonce,
        }
    }

    /// Set the nonce for a given asset ID
    pub fn set_nonce(&mut self, asset_id: u8, nonce: u128) {
        match asset_id {
            Self::ASSET_USDC => self.usdc_nonce = nonce,
            Self::ASSET_TSLA => self.tsla_nonce = nonce,
            Self::ASSET_SPY => self.spy_nonce = nonce,
            Self::ASSET_AAPL => self.aapl_nonce = nonce,
            _ => self.usdc_nonce = nonce,
        }
    }
}

// Keep the old name as a type alias for backward compatibility during migration
pub type UserPrivacyAccount = UserProfile;
