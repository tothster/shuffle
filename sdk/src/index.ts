// Main SDK exports
export { ShuffleClient } from "./client";

// Types
export type {
  UserBalance,
  OrderInfo,
  DecryptedOrderInfo,
  BatchInfo,
  BatchResult,
  PairResult,
  ShuffleConfig,
  EstimatedPayout,
  EffectiveBalance,
} from "./types";

// Constants & Enums
export {
  AssetId,
  PairId,
  Direction,
  PROGRAM_ID,
  NUM_PAIRS,
  NUM_ASSETS,
  POOL_SEED,
  USER_SEED,
  BATCH_ACCUMULATOR_SEED,
  BATCH_LOG_SEED,
  VAULT_SEED,
  VAULT_ASSET_SEEDS,
  ASSET_LABELS,
  PAIR_TOKENS,
} from "./constants";

// PDA helpers
export {
  getPoolPDA,
  getUserAccountPDA,
  getBatchAccumulatorPDA,
  getBatchLogPDA,
  getVaultPDA,
} from "./pda";

// Encryption helpers
export {
  generateEncryptionKeypair,
  createCipher,
  encryptValue,
  decryptValue,
  fetchMXEPublicKey,
  nonceToBN,
} from "./encryption";
export type { EncryptionKeypair, EncryptedValue } from "./encryption";

// Errors
export { ShuffleError, parseError, ERROR_MAP } from "./errors";
