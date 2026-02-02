import { PublicKey } from "@solana/web3.js";

// Program ID (localnet default from Anchor.toml)
export const PROGRAM_ID = new PublicKey("BzaakuSahkVtEXKqZnD9tSPBoiJCMLa1nzQHUjtY1xRM");

// Asset IDs matching contract/programs/shuffle_protocol/src/constants.rs
export enum AssetId {
  USDC = 0,
  TSLA = 1,
  SPY = 2,
  AAPL = 3,
}

// Pair IDs for the 6 trading pairs (4 choose 2)
export enum PairId {
  TSLA_USDC = 0,
  SPY_USDC = 1,
  AAPL_USDC = 2,
  TSLA_SPY = 3,
  TSLA_AAPL = 4,
  SPY_AAPL = 5,
}

// Order direction
export enum Direction {
  AtoB = 0,
  BtoA = 1,
}

export const NUM_PAIRS = 6;
export const NUM_ASSETS = 4;

// PDA seeds (must match Rust constants)
export const POOL_SEED = "pool";
export const USER_SEED = "user";
export const BATCH_ACCUMULATOR_SEED = "batch_accumulator";
export const BATCH_LOG_SEED = "batch_log";
export const VAULT_SEED = "vault";

// Per-asset vault sub-seeds
export const VAULT_ASSET_SEEDS: Record<AssetId, string> = {
  [AssetId.USDC]: "usdc",
  [AssetId.TSLA]: "tsla",
  [AssetId.SPY]: "spy",
  [AssetId.AAPL]: "aapl",
};

// Asset labels for display
export const ASSET_LABELS: Record<AssetId, string> = {
  [AssetId.USDC]: "USDC",
  [AssetId.TSLA]: "TSLA",
  [AssetId.SPY]: "SPY",
  [AssetId.AAPL]: "AAPL",
};

// Pair token mapping: pairId -> [baseAsset, quoteAsset]
export const PAIR_TOKENS: Record<PairId, [AssetId, AssetId]> = {
  [PairId.TSLA_USDC]: [AssetId.TSLA, AssetId.USDC],
  [PairId.SPY_USDC]: [AssetId.SPY, AssetId.USDC],
  [PairId.AAPL_USDC]: [AssetId.AAPL, AssetId.USDC],
  [PairId.TSLA_SPY]: [AssetId.TSLA, AssetId.SPY],
  [PairId.TSLA_AAPL]: [AssetId.TSLA, AssetId.AAPL],
  [PairId.SPY_AAPL]: [AssetId.SPY, AssetId.AAPL],
};
