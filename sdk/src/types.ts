import { PublicKey } from "@solana/web3.js";
import { AssetId, PairId, Direction } from "./constants";
import * as anchor from "@coral-xyz/anchor";

/** Decrypted balances for all 4 assets */
export interface UserBalance {
  usdc: bigint;
  tsla: bigint;
  spy: bigint;
  aapl: bigint;
}

/** Pending order info (decoded from on-chain UserProfile) */
export interface OrderInfo {
  batchId: number;
  pairId: number[];  // encrypted [u8; 32]
  direction: number[]; // encrypted [u8; 32]
  encryptedAmount: number[]; // encrypted [u8; 32]
}

/** Decrypted order info - user-readable after decryption */
export interface DecryptedOrderInfo {
  batchId: number;
  pairId: number;
  direction: number;
  amount: bigint;
}

/** Batch accumulator state */
export interface BatchInfo {
  batchId: number;
  orderCount: number;
  /** MXE nonce - 0 means batch state needs initialization */
  mxeNonce: string;
}

/** Per-pair result from a batch execution */
export interface PairResult {
  totalAIn: anchor.BN;
  totalBIn: anchor.BN;
  finalPoolA: anchor.BN;
  finalPoolB: anchor.BN;
}

/** Full batch log with results for all 6 pairs */
export interface BatchResult {
  batchId: number;
  results: PairResult[];
}

/** SDK constructor configuration */
export interface ShuffleConfig {
  connection: anchor.web3.Connection;
  wallet: anchor.Wallet;
  programId?: PublicKey;
  /** Arcium cluster offset (default: 0 for localnet) */
  clusterOffset?: number;
}

/** Estimated payout for a pending order after batch execution */
export interface EstimatedPayout {
  /** The batch this payout is from */
  batchId: number;
  /** The pair for this order */
  pairId: number;
  /** Direction: 0=A_to_B, 1=B_to_A */
  direction: number;
  /** User's order amount (decrypted) */
  orderAmount: bigint;
  /** Total input to the pool for this direction */
  totalInput: bigint;
  /** Final pool output for this direction */
  finalPoolOutput: bigint;
  /** Calculated pro-rata payout */
  estimatedPayout: bigint;
  /** Output asset ID (what the user receives) */
  outputAssetId: AssetId;
}

/** Effective balance including pending payout */
export interface EffectiveBalance {
  /** Current on-chain balance */
  currentBalance: bigint;
  /** Estimated payout from pending order (0 if none) */
  pendingPayout: bigint;
  /** Total effective balance (current + pending) */
  effectiveBalance: bigint;
  /** Whether there's a pending order to settle */
  hasPendingOrder: boolean;
}

/** Re-export enums for convenience */
export { AssetId, PairId, Direction };

