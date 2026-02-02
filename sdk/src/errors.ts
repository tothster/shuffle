/** Maps Anchor error codes (6000+) to readable names and messages */
export const ERROR_MAP: Record<number, { name: string; message: string }> = {
  6000: { name: "ProtocolPaused", message: "Protocol is paused" },
  6001: { name: "Unauthorized", message: "Unauthorized" },
  6002: { name: "InvalidAmount", message: "Invalid amount" },
  6003: { name: "InvalidAsset", message: "Invalid asset" },
  6004: { name: "InvalidAssetId", message: "Invalid asset ID (must be 0-3)" },
  6005: { name: "InvalidPairId", message: "Invalid pair ID (must be 0-5)" },
  6006: { name: "InvalidMint", message: "Invalid token mint" },
  6007: { name: "InvalidOwner", message: "Invalid token account owner" },
  6008: { name: "FeeTooHigh", message: "Fee too high (max 10%)" },
  6009: { name: "PendingOrderExists", message: "User has a pending order - settle before placing a new one" },
  6010: { name: "NoPendingOrder", message: "No pending order to settle" },
  6011: { name: "BatchNotFinalized", message: "Batch not yet executed" },
  6012: { name: "BatchIdMismatch", message: "Batch ID mismatch" },
  6013: { name: "InsufficientBalance", message: "Insufficient balance" },
  6014: { name: "MinOutputNotMet", message: "Minimum output not met" },
  6015: { name: "DivisionByZero", message: "Division by zero in settlement" },
  6016: { name: "AbortedComputation", message: "The computation was aborted" },
  6017: { name: "ComputationFailed", message: "MPC computation failed" },
  6018: { name: "ClusterNotSet", message: "Cluster not set" },
  6019: { name: "RecipientAccountNotFound", message: "Recipient account not found" },
};

export class ShuffleError extends Error {
  code: number;
  errorName: string;

  constructor(code: number) {
    const info = ERROR_MAP[code] || { name: "Unknown", message: `Unknown error code: ${code}` };
    super(info.message);
    this.code = code;
    this.errorName = info.name;
    this.name = "ShuffleError";
  }
}

/** Extract a readable error from an Anchor error object */
export function parseError(error: any): ShuffleError | Error {
  const code = error?.error?.errorCode?.number;
  if (code && ERROR_MAP[code]) {
    return new ShuffleError(code);
  }
  return error instanceof Error ? error : new Error(String(error));
}
