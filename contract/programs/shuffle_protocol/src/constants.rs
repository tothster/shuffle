use anchor_lang::prelude::*;

// =============================================================================
// ASSET IDENTIFIERS
// =============================================================================
// These IDs are used to identify which asset a user is trading.
// The new architecture uses 4 assets: USDC, TSLA, SPY, AAPL.
//

/// USDC (stablecoin) - Asset ID 0
pub const ASSET_USDC: u8 = 0;

/// TSLA (tokenized Tesla stock) - Asset ID 1
pub const ASSET_TSLA: u8 = 1;

/// SPY (tokenized S&P 500 ETF) - Asset ID 2
pub const ASSET_SPY: u8 = 2;

/// AAPL (tokenized Apple stock) - Asset ID 3
pub const ASSET_AAPL: u8 = 3;

// =============================================================================
// TRADING PAIR IDENTIFIERS
// =============================================================================
// 6 pairs formed from 4 assets (combinatorial pairs).
// These are used in the Omni-Batch architecture.

/// TSLA / USDC - Pair ID 0
pub const PAIR_TSLA_USDC: u8 = 0;

/// SPY / USDC - Pair ID 1  
pub const PAIR_SPY_USDC: u8 = 1;

/// AAPL / USDC - Pair ID 2
pub const PAIR_AAPL_USDC: u8 = 2;

/// TSLA / SPY - Pair ID 3
pub const PAIR_TSLA_SPY: u8 = 3;

/// TSLA / AAPL - Pair ID 4
pub const PAIR_TSLA_AAPL: u8 = 4;

/// SPY / AAPL - Pair ID 5
pub const PAIR_SPY_AAPL: u8 = 5;

/// Number of supported trading pairs
pub const NUM_PAIRS: u8 = 6;

// =============================================================================
// BATCH CONFIGURATION
// =============================================================================

/// Default number of orders to trigger batch execution
pub const BATCH_EXECUTION_TRIGGER: u8 = 8;

// =============================================================================
// FEE LIMITS
// =============================================================================

/// Maximum execution fee in basis points (1000 = 10%)
/// This prevents the admin from setting unreasonably high fees
pub const MAX_FEE_BPS: u16 = 1000;

// =============================================================================
// TOKEN MINTS (Devnet)
// =============================================================================
// These are placeholder addresses for test tokens on devnet.
// SPY will be created; existing mints retained for USDC, TSLA, AAPL.
//

/// Jupiter Aggregator V6 program ID
/// This is the DEX aggregator we'll use for swaps
pub const JUPITER_PROGRAM_ID: Pubkey = pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

// =============================================================================
// DEVNET TOKEN MINTS
// =============================================================================
// These are mock token mints created on devnet for testing.
// All mints have 6 decimals (like real USDC).

/// USDC mock mint - 6 decimals like real USDC
pub const USDC_MINT: Pubkey = pubkey!("55r3igkKFoYfCSFJ1zhmiTjyj95k2xfKc7xAfucsmVub");

/// AAPL (tokenized Apple) mock mint - 6 decimals
pub const AAPL_MINT: Pubkey = pubkey!("137FxZP6WRv7rAYNV2Ta3DSVUYyDwzCixvsJWAbVH9WR");

/// TSLA (tokenized Tesla) mock mint - 6 decimals
pub const TSLA_MINT: Pubkey = pubkey!("2u22u6k7B1rQakNBvnG8GoEvmAmyVoHXLx17e1VsaQ3Y");

/// SPY (tokenized S&P 500) mock mint - 6 decimals
/// TODO: Create this mint on devnet
pub const SPY_MINT: Pubkey = pubkey!("11111111111111111111111111111111"); // Placeholder

// =============================================================================
// PDA SEEDS
// =============================================================================
// PDA (Program Derived Address) seeds are used to derive deterministic addresses.

/// Seed for the main pool account
pub const POOL_SEED: &[u8] = b"pool";

/// Seed prefix for user accounts
pub const USER_SEED: &[u8] = b"user";

/// Seed for the batch accumulator account (singleton)
pub const BATCH_ACCUMULATOR_SEED: &[u8] = b"batch_accumulator";

/// Seed prefix for batch log accounts
pub const BATCH_LOG_SEED: &[u8] = b"batch_log";

/// Seed prefix for vault accounts (user deposits)
pub const VAULT_SEED: &[u8] = b"vault";

// Vault-specific seeds
pub const VAULT_USDC_SEED: &[u8] = b"usdc";
pub const VAULT_TSLA_SEED: &[u8] = b"tsla";
pub const VAULT_SPY_SEED: &[u8] = b"spy";
pub const VAULT_AAPL_SEED: &[u8] = b"aapl";

// =============================================================================
// RESERVE SEEDS (LIQUIDITY RESERVES)
// =============================================================================
// Reserve vaults hold protocol liquidity for fulfilling net surplus during
// batch execution. Separate from user deposit vaults.

/// Seed prefix for reserve accounts (protocol liquidity)
pub const RESERVE_SEED: &[u8] = b"reserve";

// Reserve-specific seeds (combined with RESERVE_SEED)
pub const RESERVE_USDC_SEED: &[u8] = b"usdc";
pub const RESERVE_TSLA_SEED: &[u8] = b"tsla";
pub const RESERVE_SPY_SEED: &[u8] = b"spy";
pub const RESERVE_AAPL_SEED: &[u8] = b"aapl";

// =============================================================================
// FAUCET CONFIGURATION (Devnet only)
// =============================================================================
// Faucet allows users to claim free USDC for testing on devnet.
// Each user can claim up to FAUCET_MAX_PER_USER total.

/// Seed for the faucet USDC vault
pub const FAUCET_VAULT_SEED: &[u8] = b"faucet_usdc";

/// Maximum USDC a single user can claim from faucet (1000 USDC with 6 decimals)
pub const FAUCET_MAX_PER_USER: u64 = 1_000_000_000;
