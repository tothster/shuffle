// =============================================================================
// STATE MODULE
// =============================================================================
// This module contains all the account structures (state) for the Shuffle Protocol protocol.
//

// Re-export all state structs for easy importing
// Usage: `use crate::state::{Pool, UserProfile, BatchAccumulator, BatchLog};`

mod batch;
mod pool;
mod user;

pub use batch::*;
pub use pool::*;
pub use user::*;
