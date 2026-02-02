use anchor_lang::prelude::*;

use crate::state::{PairAccumulator, NUM_PAIRS};
use crate::InitBatchAccumulator;

/// Handler for init_batch_accumulator instruction.
/// Creates the singleton BatchAccumulator PDA with initial values.
pub fn handler(ctx: Context<InitBatchAccumulator>) -> Result<()> {
    let batch = &mut ctx.accounts.batch_accumulator;

    // Initialize with batch_id = 1 (first batch)
    batch.batch_id = 1;
    // Initialize plaintext order_count to 0
    batch.order_count = 0;

    // Initialize all pair states with zero (encrypted zeros will be set by MPC)
    // For now, use raw zeros as placeholder until first MPC operation
    batch.pair_states = [PairAccumulator::default(); NUM_PAIRS];

    // Initialize MXE nonce to 0 (will be set by init_batch_state_callback)
    batch.mxe_nonce = 0;

    batch.bump = ctx.bumps.batch_accumulator;

    msg!("BatchAccumulator initialized with batch_id: 1");

    Ok(())
}
