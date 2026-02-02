// =============================================================================
// INSTRUCTIONS MODULE
// =============================================================================
// This module contains all the instruction handlers for the Shuffle Protocol protocol.
//

pub mod add_liquidity;
pub mod create_user_account;
pub mod execute_batch;
pub mod execute_swaps;
pub mod faucet;
pub mod init_batch_accumulator;
pub mod initialize;
pub mod place_order;
pub mod remove_liquidity;
pub mod settle_order;
pub mod test_swap;
// deposit removed in Phase 6 - use add_balance instruction instead (encrypted via Arcium)

// Note: Account structs (like Initialize, CreateUserAccount, Deposit) are defined in lib.rs
// for Anchor's IDL generation. Only handlers are defined in this module.
// mod submit_order;         // Phase 7
// mod create_dca;           // Phase 8
// mod execute_batch;        // Phase 9
// mod withdraw;             // Phase 10
// mod cancel_order;         // Phase 11
