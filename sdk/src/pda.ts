import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import {
  POOL_SEED,
  USER_SEED,
  BATCH_ACCUMULATOR_SEED,
  BATCH_LOG_SEED,
  VAULT_SEED,
} from "./constants";

export function getPoolPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(POOL_SEED)],
    programId
  );
}

export function getUserAccountPDA(
  programId: PublicKey,
  owner: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(USER_SEED), owner.toBuffer()],
    programId
  );
}

export function getBatchAccumulatorPDA(
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(BATCH_ACCUMULATOR_SEED)],
    programId
  );
}

export function getBatchLogPDA(
  programId: PublicKey,
  batchId: number | anchor.BN
): [PublicKey, number] {
  const bn = typeof batchId === "number" ? new anchor.BN(batchId) : batchId;
  return PublicKey.findProgramAddressSync(
    [Buffer.from(BATCH_LOG_SEED), Buffer.from(bn.toArray("le", 8))],
    programId
  );
}

export function getVaultPDA(
  programId: PublicKey,
  assetSeed: string
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(VAULT_SEED), Buffer.from(assetSeed)],
    programId
  );
}
