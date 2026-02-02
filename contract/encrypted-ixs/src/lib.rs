// =============================================================================
// ARCIS CIRCUITS FOR OMNI-BATCH PRIVATE AGGREGATOR
// =============================================================================
// Simplified circuits using Enc<Shared, T> for user-readable encrypted state.
//
// Key Pattern:
// - Use Enc<Shared, T> for ALL user data (user can decrypt via shared secret)
// - Use Enc<Mxe, T> only for protocol-owned state (batch accumulators)
// - Use .to_arcis() to decrypt, owner.from_arcis() to re-encrypt
//
// MPC Pattern: Both if/else branches always execute when condition is secret.
// Balance checks must happen on-chain BEFORE MPC, or use conditional patterns.

use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    // =========================================================================
    // DATA STRUCTURES
    // =========================================================================

    /// User balance for a single asset (stored on-chain as Enc<Shared, UserBalance>)
    /// User encrypts with their shared secret, so they can always decrypt from frontend.
    #[derive(Copy, Clone, Default)]
    pub struct UserBalance {
        pub balance: u64,
    }

    /// Request to update a balance (add or subtract)
    #[derive(Copy, Clone)]
    pub struct BalanceUpdate {
        pub amount: u64,
    }

    /// Transfer request between two users
    #[derive(Copy, Clone)]
    pub struct TransferRequest {
        pub amount: u64,
    }

    /// Result of an operation with success flag
    #[derive(Copy, Clone)]
    pub struct BalanceResult {
        pub balance: u64,
        pub success: bool,
    }

    // =========================================================================
    // BALANCE CIRCUITS
    // =========================================================================

    /// Add to user's balance (deposit).
    /// Both input and output use Enc<Shared, *> so user can always decrypt.
    #[instruction]
    pub fn add_balance(
        update_ctxt: Enc<Shared, BalanceUpdate>,
        balance_ctxt: Enc<Shared, UserBalance>,
    ) -> Enc<Shared, UserBalance> {
        let update = update_ctxt.to_arcis();
        let mut balance = balance_ctxt.to_arcis();

        balance.balance += update.amount;

        // Return with same Shared owner so user can decrypt
        update_ctxt.owner.from_arcis(balance)
    }

    /// Subtract from user's balance (withdrawal).
    /// Returns (has_funds, new_balance) so callback can verify success.
    /// If has_funds is false, balance is unchanged and callback should abort.
    /// Both input and output use Enc<Shared, *> so user can always decrypt.
    #[instruction]
    pub fn sub_balance(
        update_ctxt: Enc<Shared, BalanceUpdate>,
        balance_ctxt: Enc<Shared, UserBalance>,
    ) -> (bool, Enc<Shared, UserBalance>) {
        let update = update_ctxt.to_arcis();
        let balance = balance_ctxt.to_arcis();

        // Check if user has sufficient balance
        let has_funds = balance.balance >= update.amount;

        // Only deduct if has_funds, otherwise return unchanged balance
        let new_balance = if has_funds {
            balance.balance - update.amount
        } else {
            balance.balance // Unchanged if insufficient
        };

        // Return success flag (revealed to public) and new balance
        (
            has_funds.reveal(),
            update_ctxt.owner.from_arcis(UserBalance {
                balance: new_balance,
            }),
        )
    }

    /// Atomic P2P transfer between two users.
    /// Updates both sender and recipient in single MPC.
    /// Uses saturating subtraction for sender.
    /// Both balances use Enc<Shared> so each user can decrypt their own balance.
    #[instruction]
    pub fn transfer(
        request_ctxt: Enc<Shared, TransferRequest>,
        sender_ctxt: Enc<Shared, UserBalance>,
        recipient_ctxt: Enc<Shared, UserBalance>,
    ) -> (Enc<Shared, UserBalance>, Enc<Shared, UserBalance>) {
        let request = request_ctxt.to_arcis();
        let sender = sender_ctxt.to_arcis();
        let recipient = recipient_ctxt.to_arcis();

        // Check if sender has sufficient balance
        let has_funds = sender.balance >= request.amount;

        // Only update if has_funds (MPC executes both branches, picks based on condition)
        let new_sender_balance = if has_funds {
            sender.balance - request.amount
        } else {
            sender.balance // No change if insufficient
        };

        let new_recipient_balance = if has_funds {
            recipient.balance + request.amount
        } else {
            recipient.balance // No change if insufficient
        };

        // Both use Enc<Shared> - each user's balance encrypted with their own shared secret
        (
            sender_ctxt.owner.from_arcis(UserBalance {
                balance: new_sender_balance,
            }),
            recipient_ctxt.owner.from_arcis(UserBalance {
                balance: new_recipient_balance,
            }),
        )
    }

    // =========================================================================
    // BATCH ACCUMULATOR CIRCUITS (for Omni-Batch)
    // =========================================================================

    /// Encrypted order for placement in batch
    #[derive(Copy, Clone)]
    pub struct OrderInput {
        /// Pair ID (0-5)
        pub pair_id: u8,
        /// Direction: 0 = A_to_B, 1 = B_to_A
        pub direction: u8,
        /// Order amount
        pub amount: u64,
    }

    /// Per-pair accumulator totals
    #[derive(Copy, Clone, Default)]
    pub struct PairTotals {
        pub total_a_in: u64,
        pub total_b_in: u64,
    }

    /// Global batch state (all 6 pairs)
    pub const NUM_PAIRS: usize = 6;

    #[derive(Copy, Clone)]
    pub struct BatchState {
        pub pairs: [PairTotals; NUM_PAIRS],
    }

    /// Initialize empty batch state
    #[instruction]
    pub fn init_batch_state(mxe: Mxe) -> Enc<Mxe, BatchState> {
        let empty_pair = PairTotals {
            total_a_in: 0,
            total_b_in: 0,
        };
        let empty_pairs = [empty_pair; NUM_PAIRS];
        mxe.from_arcis(BatchState { pairs: empty_pairs })
    }

    /// Accumulate an order into the batch.
    /// Also deducts from user's balance atomically.
    /// Returns (has_funds, batch_ready, new_balance, new_batch_state).
    /// - has_funds: false if user lacks balance, callback should abort
    /// - batch_ready: true if batch meets requirements (order_count >= 8 AND >= 2 pairs with activity)
    ///
    /// NOTE: order_count is passed as plaintext input (tracked on Solana side).
    /// Active pairs are calculated transiently by checking encrypted pair totals.
    ///
    /// NOTE: User balance uses Enc<Shared,*> so users can decrypt their updated balance.
    /// Batch state uses Enc<Mxe,*> since it's protocol-owned and users shouldn't see aggregates.
    #[instruction]
    pub fn accumulate_order(
        order_ctxt: Enc<Shared, OrderInput>,
        balance_ctxt: Enc<Shared, UserBalance>,
        batch_ctxt: Enc<Mxe, BatchState>,
        order_count: u8, // Plaintext: current order count (before this order)
    ) -> (bool, bool, Enc<Shared, UserBalance>, Enc<Mxe, BatchState>) {
        let order = order_ctxt.to_arcis();
        let balance = balance_ctxt.to_arcis();
        let mut batch = batch_ctxt.to_arcis();

        // Check if user has sufficient balance
        let has_funds = balance.balance >= order.amount;

        // Only deduct if has funds
        let new_balance = if has_funds {
            balance.balance - order.amount
        } else {
            balance.balance // Unchanged if insufficient
        };

        // Only accumulate if has_funds
        // direction == 0 means selling Token A, direction == 1 means selling Token B
        for i in 0..NUM_PAIRS {
            let is_target = i == order.pair_id as usize;
            let is_a_direction = order.direction == 0;

            if is_target && has_funds {
                if is_a_direction {
                    batch.pairs[i].total_a_in += order.amount;
                } else {
                    batch.pairs[i].total_b_in += order.amount;
                }
            }
        }

        // Calculate new order count (increment if has_funds)
        let new_order_count = if has_funds {
            order_count + 1
        } else {
            order_count
        };

        // Count active pairs (pairs with any activity - encrypted comparison)
        let mut pair_count: u8 = 0;
        for i in 0..NUM_PAIRS {
            let has_activity = batch.pairs[i].total_a_in > 0 || batch.pairs[i].total_b_in > 0;
            if has_activity {
                pair_count += 1;
            }
        }

        // Check batch requirements: >= 8 orders AND >= 2 active pairs
        let batch_ready = new_order_count >= 8 && pair_count >= 2;

        // Return success flag, batch_ready, and updated state
        (
            has_funds.reveal(),
            batch_ready.reveal(),
            balance_ctxt.owner.from_arcis(UserBalance {
                balance: new_balance,
            }),
            batch_ctxt.owner.from_arcis(batch),
        )
    }

    /// Reveal batch totals for execution.
    /// Returns plaintext totals for all 6 pairs (12 values).
    #[instruction]
    pub fn reveal_batch(batch_ctxt: Enc<Mxe, BatchState>) -> [u64; 12] {
        let batch = batch_ctxt.to_arcis();

        // Flatten to array: [pair0_a, pair0_b, pair1_a, pair1_b, ...]
        let mut result: [u64; 12] = [0; 12];
        for i in 0..NUM_PAIRS {
            result[i * 2] = batch.pairs[i].total_a_in;
            result[i * 2 + 1] = batch.pairs[i].total_b_in;
        }

        result.reveal()
    }

    // =========================================================================
    // SETTLEMENT CIRCUIT (Phase 10)
    // =========================================================================

    /// Calculate pro-rata payout for settlement.
    /// Takes full encrypted order (to preserve struct encryption context),
    /// plaintext current balance, plus plaintext batch totals,
    /// and returns updated balance with payout added.
    ///
    /// NOTE: current_balance is plaintext because output asset balances may not have been
    /// MPC-processed yet (first settlement on that asset).
    ///
    /// DEBUG: Also returns revealed payout to verify computation is correct
    #[instruction]
    pub fn calculate_payout(
        order_ctxt: Enc<Shared, OrderInput>, // Full order struct (was: Enc<Shared, u64>)
        current_balance: u64,                // Plaintext - first settlement has zero
        total_input: u64,
        final_pool_output: u64,
    ) -> (Enc<Shared, UserBalance>, u64) {
        // Extract just the amount from the order struct
        let order = order_ctxt.to_arcis();
        let order_amount = order.amount;

        // Pro-rata formula: (order_amount * final_pool_output) / total_input
        let payout = if total_input > 0 {
            ((order_amount as u128 * final_pool_output as u128) / total_input as u128) as u64
        } else {
            0 // Zero liquidity case
        };

        let new_balance = current_balance + payout;

        // Return both encrypted balance AND revealed payout for debugging
        (
            order_ctxt.owner.from_arcis(UserBalance {
                balance: new_balance,
            }),
            payout.reveal(),
        )
    }

    // =========================================================================
    // DEMO CIRCUIT (kept for testing)
    // =========================================================================

    #[derive(Copy, Clone)]
    pub struct TwoNumbers {
        pub a: u8,
        pub b: u8,
    }

    #[instruction]
    pub fn add_together(ctxt: Enc<Shared, TwoNumbers>) -> Enc<Shared, u8> {
        let input = ctxt.to_arcis();
        let sum = input.a + input.b;
        ctxt.owner.from_arcis(sum)
    }
}
