use anchor_lang::prelude::*;

// =============================================================================
// POOL ACCOUNT
// =============================================================================
// The Pool is the central state account for the entire protocol.
// There is only ONE Pool account, derived from the seed "pool".
//

/// Central state account for the Shuffle Protocol protocol.
/// PDA derived with seeds: ["pool"]
#[account]
pub struct Pool {
    /// Admin authority that can update settings and pause the protocol.
    /// Should be a multisig for production.
    pub authority: Pubkey,

    /// Operator wallet that can trigger batch execution.
    /// This is typically an automated backend service.
    pub operator: Pubkey,

    /// Treasury account where execution fees are sent.
    pub treasury: Pubkey,

    // =========================================================================
    // TOKEN MINT ADDRESSES (4 assets: USDC, TSLA, SPY, AAPL)
    // =========================================================================
    // These are stored during initialization, allowing the protocol to work
    // with different mints on localnet vs devnet vs mainnet.
    /// USDC token mint address
    pub usdc_mint: Pubkey,

    /// TSLA (tokenized Tesla) mint address
    pub tsla_mint: Pubkey,

    /// SPY (tokenized S&P 500 ETF) mint address
    pub spy_mint: Pubkey,

    /// AAPL (tokenized Apple) mint address
    pub aapl_mint: Pubkey,

    // =========================================================================
    // BATCH CONFIGURATION
    // =========================================================================
    /// Current active batch ID
    pub current_batch_id: u64,

    /// Number of orders required to trigger batch execution (default: 8)
    pub execution_trigger_count: u8,

    // =========================================================================
    // PROTOCOL PARAMETERS
    // =========================================================================
    /// Execution fee in basis points.
    /// 50 = 0.5%, 100 = 1%, etc.
    /// Max allowed is 1000 (10%).
    pub execution_fee_bps: u16,

    /// PDA bump seed for signing transactions.
    /// Used when the Pool PDA needs to sign (e.g., token transfers from vaults).
    pub bump: u8,

    /// Emergency pause flag.
    /// When true, most operations are blocked.
    pub paused: bool,

    /// Total fees collected in USDC base units (for analytics).
    pub total_fees_collected: u64,

    /// Total batches executed (for analytics).
    pub total_batches_executed: u64,
}

impl Pool {
    /// Size of the Pool account in bytes.
    /// Used when creating the account: space = Pool::SIZE
    ///
    /// Calculation:
    /// - 8 bytes: Anchor discriminator (automatically added)
    /// - 32 bytes: authority (Pubkey)
    /// - 32 bytes: operator (Pubkey)
    /// - 32 bytes: treasury (Pubkey)
    /// - 32 bytes: usdc_mint (Pubkey)
    /// - 32 bytes: tsla_mint (Pubkey)
    /// - 32 bytes: spy_mint (Pubkey)
    /// - 32 bytes: aapl_mint (Pubkey)
    /// - 8 bytes: current_batch_id (u64)
    /// - 1 byte: execution_trigger_count (u8)
    /// - 2 bytes: execution_fee_bps (u16)
    /// - 1 byte: bump (u8)
    /// - 1 byte: paused (bool)
    /// - 8 bytes: total_fees_collected (u64)
    /// - 8 bytes: total_batches_executed (u64)
    pub const SIZE: usize = 8 + // discriminator
        32 +  // authority
        32 +  // operator
        32 +  // treasury
        32 +  // usdc_mint
        32 +  // tsla_mint
        32 +  // spy_mint
        32 +  // aapl_mint
        8 +   // current_batch_id
        1 +   // execution_trigger_count
        2 +   // execution_fee_bps
        1 +   // bump
        1 +   // paused
        8 +   // total_fees_collected
        8; // total_batches_executed
}
