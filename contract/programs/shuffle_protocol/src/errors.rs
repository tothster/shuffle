use anchor_lang::prelude::*;

// =============================================================================
// ERROR CODES
// =============================================================================
// These are custom errors that our program can return.
//

#[error_code]
pub enum ErrorCode {
    // =========================================================================
    // PROTOCOL STATE ERRORS
    // =========================================================================
    /// Protocol is paused by admin - no operations allowed
    #[msg("Protocol is paused")]
    ProtocolPaused,

    // =========================================================================
    // AUTHORIZATION ERRORS
    // =========================================================================
    /// Caller is not authorized to perform this action
    #[msg("Unauthorized")]
    Unauthorized,

    // =========================================================================
    // INPUT VALIDATION ERRORS
    // =========================================================================
    /// Amount must be greater than zero
    #[msg("Invalid amount")]
    InvalidAmount,

    /// Asset ID not recognized (must be 0-3 for USDC, TSLA, SPY, AAPL)
    #[msg("Invalid asset")]
    InvalidAsset,

    /// Asset ID out of range (must be 0-3)
    #[msg("Invalid asset ID (must be 0-3 for USDC, TSLA, SPY, AAPL)")]
    InvalidAssetId,

    /// Pair ID not recognized (must be 0-5)
    #[msg("Invalid pair ID (must be 0-5)")]
    InvalidPairId,

    /// Token mint address doesn't match expected (wrong token)
    #[msg("Invalid token mint")]
    InvalidMint,

    /// Token account owner doesn't match expected
    #[msg("Invalid token account owner")]
    InvalidOwner,

    /// Execution fee cannot exceed 10% (1000 basis points)
    #[msg("Fee too high (max 10%)")]
    FeeTooHigh,

    // =========================================================================
    // ORDER/BATCH STATE ERRORS
    // =========================================================================
    /// User already has a pending order that must be settled first
    #[msg("User has a pending order - settle before placing a new one")]
    PendingOrderExists,

    /// No pending order to settle
    #[msg("No pending order to settle")]
    NoPendingOrder,

    /// Trying to settle from a batch that hasn't been executed yet
    #[msg("Batch not yet executed")]
    BatchNotFinalized,

    /// Batch ID mismatch during settlement
    #[msg("Batch ID mismatch")]
    BatchIdMismatch,

    /// Batch ID doesn't match the BatchLog
    #[msg("Invalid batch ID - doesn't match BatchLog")]
    InvalidBatchId,

    /// Swaps have already been executed for this batch
    #[msg("Swaps already executed for this batch")]
    SwapsAlreadyExecuted,

    // =========================================================================
    // BALANCE ERRORS
    // =========================================================================
    /// User doesn't have enough balance for the requested operation
    #[msg("Insufficient balance")]
    InsufficientBalance,

    // =========================================================================
    // SWAP EXECUTION ERRORS
    // =========================================================================
    /// Swap didn't return enough tokens (slippage protection triggered)
    #[msg("Minimum output not met")]
    MinOutputNotMet,

    /// Division by zero during settlement calculation
    #[msg("Division by zero in settlement - no input for this pair")]
    DivisionByZero,

    // =========================================================================
    // ARCIUM MPC ERRORS
    // =========================================================================
    /// MPC computation was aborted by the Arcium cluster
    #[msg("The computation was aborted")]
    AbortedComputation,

    /// MPC computation returned an invalid result
    #[msg("MPC computation failed")]
    ComputationFailed,

    /// Arcium cluster not properly configured
    #[msg("Cluster not set")]
    ClusterNotSet,

    // =========================================================================
    // P2P TRANSFER ERRORS
    // =========================================================================
    /// Recipient does not have a privacy account - they must create one first
    #[msg("Recipient account not found - they must create a privacy account first")]
    RecipientAccountNotFound,

    // =========================================================================
    // FAUCET ERRORS
    // =========================================================================
    /// User has already claimed the maximum allowed from faucet
    #[msg("Faucet limit exceeded - you can only claim up to 1000 USDC total")]
    FaucetLimitExceeded,
}
