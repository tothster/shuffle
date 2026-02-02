/**
 * Shared Test Setup
 *
 * Creates mints once and initializes both shuffle_protocol and mock_jupiter
 * idempotently. All test files import from here to ensure consistent mints
 * across the shared validator.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { ShuffleProtocol } from "../../target/types/shuffle_protocol";
import { MockJupiter } from "../../target/types/mock_jupiter";
import {
  createMint,
  createInitializeAccountInstruction,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  ACCOUNT_SIZE,
  getMinimumBalanceForRentExemptAccount,
} from "@solana/spl-token";

// =============================================================================
// SHARED STATE (populated by ensureSetup)
// =============================================================================

export interface SharedState {
  usdcMint: PublicKey;
  tslaMint: PublicKey;
  spyMint: PublicKey;
  aaplMint: PublicKey;
  poolPda: PublicKey;
  jupiterSwapPool: PublicKey;
}

let cachedState: SharedState | null = null;

/**
 * Ensure shuffle_protocol pool is initialized and return the shared mints.
 * Idempotent: if the pool already exists, reads mints from on-chain state.
 *
 * Call this in every test file's `before()` hook.
 */
export async function ensureShuffleProtocolPool(
  provider: anchor.AnchorProvider,
  shuffleProtocol: Program<ShuffleProtocol>,
): Promise<SharedState> {
  if (cachedState) return cachedState;

  const authority = (provider.wallet as anchor.Wallet).payer;
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool")],
    shuffleProtocol.programId
  );

  let usdcMint: PublicKey;
  let tslaMint: PublicKey;
  let spyMint: PublicKey;
  let aaplMint: PublicKey;

  const existingPool = await provider.connection.getAccountInfo(poolPda);
  if (existingPool) {
    // Pool already initialized by another test — read its mints
    const poolAccount = await shuffleProtocol.account.pool.fetch(poolPda);
    usdcMint = poolAccount.usdcMint;
    tslaMint = poolAccount.tslaMint;
    spyMint = poolAccount.spyMint;
    aaplMint = poolAccount.aaplMint;
  } else {
    // First test to run — create mints and initialize pool
    usdcMint = await createMint(provider.connection, authority, authority.publicKey, null, 6);
    tslaMint = await createMint(provider.connection, authority, authority.publicKey, null, 6);
    spyMint = await createMint(provider.connection, authority, authority.publicKey, null, 6);
    aaplMint = await createMint(provider.connection, authority, authority.publicKey, null, 6);

    const [vaultUsdc] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), Buffer.from("usdc")],
      shuffleProtocol.programId
    );
    const [vaultTsla] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), Buffer.from("tsla")],
      shuffleProtocol.programId
    );
    const [vaultSpy] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), Buffer.from("spy")],
      shuffleProtocol.programId
    );
    const [vaultAapl] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), Buffer.from("aapl")],
      shuffleProtocol.programId
    );

    // Derive reserve PDAs
    const [reserveUsdc] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve"), Buffer.from("usdc")],
      shuffleProtocol.programId
    );
    const [reserveTsla] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve"), Buffer.from("tsla")],
      shuffleProtocol.programId
    );
    const [reserveSpy] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve"), Buffer.from("spy")],
      shuffleProtocol.programId
    );
    const [reserveAapl] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve"), Buffer.from("aapl")],
      shuffleProtocol.programId
    );

    // Derive faucet vault PDA (for devnet USDC faucet)
    const [faucetVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("faucet_usdc")],
      shuffleProtocol.programId
    );

    await shuffleProtocol.methods
      .initialize(50, 8)
      .accountsStrict({
        payer: authority.publicKey,
        authority: authority.publicKey,
        operator: authority.publicKey,
        treasury: authority.publicKey,
        pool: poolPda,
        usdcMint,
        tslaMint,
        spyMint,
        aaplMint,
        vaultUsdc,
        vaultTsla,
        vaultSpy,
        vaultAapl,
        reserveUsdc,
        reserveTsla,
        reserveSpy,
        reserveAapl,
        faucetVault,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Fund reserves with initial liquidity
    const INITIAL_RESERVE_AMOUNT = 100_000_000_000; // 100,000 tokens (6 decimals)
    await mintTo(provider.connection, authority, usdcMint, reserveUsdc, authority, INITIAL_RESERVE_AMOUNT);
    await mintTo(provider.connection, authority, tslaMint, reserveTsla, authority, INITIAL_RESERVE_AMOUNT);
    await mintTo(provider.connection, authority, spyMint, reserveSpy, authority, INITIAL_RESERVE_AMOUNT);
    await mintTo(provider.connection, authority, aaplMint, reserveAapl, authority, INITIAL_RESERVE_AMOUNT);
    
    // Fund faucet vault with 1 billion USDC for devnet testing
    const FAUCET_INITIAL_AMOUNT = 1_000_000_000_000_000; // 1 billion USDC (6 decimals)
    await mintTo(provider.connection, authority, usdcMint, faucetVault, authority, FAUCET_INITIAL_AMOUNT);
  }

  const [jupiterSwapPool] = PublicKey.findProgramAddressSync(
    [Buffer.from("swap_pool")],
    anchor.workspace.MockJupiter.programId
  );

  cachedState = { usdcMint, tslaMint, spyMint, aaplMint, poolPda, jupiterSwapPool };
  return cachedState;
}

/**
 * Ensure mock_jupiter swap pool is initialized with the same mints as
 * the shuffle_protocol pool. Returns vault addresses.
 */
export async function ensureJupiterPool(
  provider: anchor.AnchorProvider,
  mockJupiter: Program<MockJupiter>,
  state: SharedState,
): Promise<{
  usdcVault: PublicKey;
  tslaVault: PublicKey;
  spyVault: PublicKey;
  aaplVault: PublicKey;
}> {
  const authority = (provider.wallet as anchor.Wallet).payer;
  const existingPool = await provider.connection.getAccountInfo(state.jupiterSwapPool);

  if (existingPool) {
    // Already initialized — read vault addresses
    const poolAccount = await mockJupiter.account.swapPool.fetch(state.jupiterSwapPool);
    return {
      usdcVault: poolAccount.usdcVault,
      tslaVault: poolAccount.tslaVault,
      spyVault: poolAccount.spyVault,
      aaplVault: poolAccount.aaplVault,
    };
  }

  // Create vault token accounts owned by the swap_pool PDA
  const vaults = {
    usdcVault: await createVault(provider, authority, state.usdcMint, state.jupiterSwapPool),
    tslaVault: await createVault(provider, authority, state.tslaMint, state.jupiterSwapPool),
    spyVault: await createVault(provider, authority, state.spyMint, state.jupiterSwapPool),
    aaplVault: await createVault(provider, authority, state.aaplMint, state.jupiterSwapPool),
  };

  await mockJupiter.methods
    .initializeSwapPool()
    .accountsStrict({
      authority: authority.publicKey,
      swapPool: state.jupiterSwapPool,
      usdcMint: state.usdcMint,
      tslaMint: state.tslaMint,
      spyMint: state.spyMint,
      aaplMint: state.aaplMint,
      usdcVault: vaults.usdcVault,
      tslaVault: vaults.tslaVault,
      spyVault: vaults.spyVault,
      aaplVault: vaults.aaplVault,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return vaults;
}

/**
 * Helper: create a token account with a given owner (supports off-curve PDA owners).
 */
export async function createVault(
  provider: anchor.AnchorProvider,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> {
  const kp = Keypair.generate();
  const lamports = await getMinimumBalanceForRentExemptAccount(provider.connection);
  const tx = new anchor.web3.Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: kp.publicKey,
      space: ACCOUNT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccountInstruction(kp.publicKey, mint, owner)
  );
  await provider.sendAndConfirm(tx, [payer, kp]);
  return kp.publicKey;
}
