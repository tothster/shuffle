use anchor_lang::prelude::*;

// =============================================================================
// BATCH ACCUMULATOR & BATCH LOG
// =============================================================================
// The Omni-Batch architecture uses a global synchronized batch across 6 trading pairs.
//
// Supported Pairs (Matrix from USDC, TSLA, SPY, AAPL):
//   PairID_0: TSLA / USDC
//   PairID_1: SPY / USDC
//   PairID_2: AAPL / USDC
//   PairID_3: TSLA / SPY
//   PairID_4: TSLA / AAPL
//   PairID_5: SPY / AAPL

/// Number of trading pairs supported (6 pairs from 4 assets)
pub const NUM_PAIRS: usize = 6;

/// Per-pair encrypted totals within a batch.
/// Stores the cumulative buy/sell pressure for a single trading pair.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct PairAccumulator {
    /// Encrypted total of Token A offered to sell in this batch
    pub encrypted_token_a_in: [u8; 32],
    /// Encrypted total of Token B offered to sell in this batch
    pub encrypted_token_b_in: [u8; 32],
}

/// Transient batch state - encrypted accumulator for the currently active batch.
/// Reset after each batch execution.
///
/// PDA derived with seeds: ["batch_accumulator"]
///
/// NOTE: BatchState in MPC has 12 encrypted u64 values (6 pairs × 2 totals each).
/// order_count is tracked as plaintext on Solana and passed to MPC for batch_ready calculation.
#[account]
pub struct BatchAccumulator {
    /// Current batch ID (incrementing)
    pub batch_id: u64,

    /// Number of orders in current batch (plaintext, for batch_ready calculation)
    pub order_count: u8,

    /// Encrypted accumulator state for each of the 6 pairs
    pub pair_states: [PairAccumulator; NUM_PAIRS],

    /// MXE output nonce for next read (updated on each MPC callback)
    pub mxe_nonce: u128,

    /// PDA bump seed
    pub bump: u8,
}

impl BatchAccumulator {
    /// Size of the BatchAccumulator account in bytes.
    ///
    /// Calculation:
    /// - 8 bytes: Anchor discriminator
    /// - 8 bytes: batch_id (u64)
    /// - 1 byte: order_count (u8)
    /// - 6 * 64 bytes: pair_states (6 pairs × (32 + 32) bytes each) = 384
    /// - 16 bytes: mxe_nonce (u128)
    /// - 1 byte: bump (u8)
    pub const SIZE: usize = 8 + // discriminator
        8 +   // batch_id
        1 +   // order_count
        (NUM_PAIRS * 64) + // pair_states: 6 × (32 + 32) = 384
        16 +  // mxe_nonce
        1; // bump = 418 total
}

/// Per-pair execution results after batch finalization (plaintext).
/// Used for lazy settlement calculations.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct PairResult {
    /// Revealed total Token A input for this pair
    pub total_a_in: u64,
    /// Revealed total Token B input for this pair
    pub total_b_in: u64,
    /// Amount of Token A held after netting + swap
    pub final_pool_a: u64,
    /// Amount of Token B held after netting + swap
    pub final_pool_b: u64,
}

/// Historical batch results - immutable plaintext record after execution.
/// Used for user lazy settlement.
///
/// PDA derived with seeds: ["batch_log", batch_id.to_le_bytes()]
#[account]
pub struct BatchLog {
    /// Batch ID this log corresponds to
    pub batch_id: u64,

    /// Execution results for each of the 6 pairs
    pub results: [PairResult; NUM_PAIRS],

    /// Unix timestamp when batch was executed
    pub executed_at: i64,

    /// Whether vault↔reserve swaps have been executed for this batch
    pub swaps_executed: bool,

    /// PDA bump seed
    pub bump: u8,
}

impl BatchLog {
    /// Size of the BatchLog account in bytes.
    ///
    /// Calculation:
    /// - 8 bytes: Anchor discriminator
    /// - 8 bytes: batch_id (u64)
    /// - 6 * 32 bytes: results (6 pairs × (8 + 8 + 8 + 8) bytes each)
    /// - 8 bytes: executed_at (i64)
    /// - 1 byte: swaps_executed (bool)
    /// - 1 byte: bump (u8)
    pub const SIZE: usize = 8 + // discriminator
        8 +   // batch_id
        (NUM_PAIRS * 32) + // results: 6 × (8 + 8 + 8 + 8)
        8 +   // executed_at
        1 +   // swaps_executed
        1; // bump
}
