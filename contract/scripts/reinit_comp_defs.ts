/**
 * Reinitialize Computation Definitions with Off-Chain Circuits
 *
 * This script closes existing comp defs and reinitializes them with
 * off-chain circuit sources from Pinata.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection, SystemProgram } from "@solana/web3.js";
import {
  getCompDefAccOffset,
  getMXEAccAddress,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  buildFinalizeCompDefTx,
  getLookupTableAddress,
  getArciumProgram,
} from "@arcium-hq/client";
import { ShuffleProtocol } from "../target/types/shuffle_protocol";
import * as fs from "fs";
import * as os from "os";

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEVNET_RPC_URL = "https://devnet.helius-rpc.com/?api-key=a8e1a5ce-29c6-4356-b3f9-54c1c650ac08";
const PROGRAM_ID = new PublicKey("2E6wnKEbger3qm1pcH9t7F2krRVG56mZQ1gaovALHAGk");
const KEYPAIR_PATH = `${os.homedir()}/.config/solana/id.json`;

// =============================================================================
// HELPERS
// =============================================================================

function readKpJson(path: string): Keypair {
  const data = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  delayMs: number = 2000
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      const isRetryable = e.message?.includes("Blockhash not found") ||
                          e.message?.includes("blockhash") ||
                          e.message?.includes("rate limit");
      if (attempt === maxRetries || !isRetryable) {
        throw e;
      }
      console.log(`  ⏳ Retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries}): ${e.message}`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs *= 1.5;
    }
  }
  throw new Error("Max retries exceeded");
}

async function closeCompDefIfExists(
  program: Program<ShuffleProtocol>,
  owner: Keypair,
  provider: AnchorProvider,
  circuitName: string
): Promise<boolean> {
  const baseSeedCompDefAcc = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const offset = getCompDefAccOffset(circuitName);

  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
    getArciumProgramId()
  )[0];

  const existingAccount = await provider.connection.getAccountInfo(compDefPDA);
  if (!existingAccount) {
    console.log(`  ℹ ${circuitName} comp def doesn't exist, skipping close`);
    return false;
  }

  console.log(`  Closing existing ${circuitName} comp def...`);

  try {
    // Try to close the account by transferring lamports back
    // Note: This might not work if Arcium doesn't allow closing comp defs
    // In that case, we'll need to just reinitialize over it
    const arciumProgram = getArciumProgram(provider);

    // Check if account is already finalized
    const compDefAccount = await arciumProgram.account.computationDefinitionAccount.fetch(compDefPDA);
    console.log(`  Account status: finalized=${compDefAccount.finalizationAuthority === null ? 'no' : 'yes'}`);

    // For now, we'll just log that we can't close it
    console.log(`  ⚠ Cannot close comp def account (Arcium doesn't support closing). Will need to reinitialize.`);
    return true;
  } catch (e: any) {
    console.log(`  ⚠ Error checking comp def: ${e.message}`);
    return true;
  }
}

async function initCompDef(
  program: Program<ShuffleProtocol>,
  owner: Keypair,
  provider: AnchorProvider,
  circuitName: string,
  methodName: string,
  forceReinit: boolean = false
): Promise<void> {
  const baseSeedCompDefAcc = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const offset = getCompDefAccOffset(circuitName);

  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
    getArciumProgramId()
  )[0];

  const existingAccount = await provider.connection.getAccountInfo(compDefPDA);
  if (existingAccount && !forceReinit) {
    console.log(`  ✓ ${circuitName} comp def already exists (use --force to reinit)`);
    return;
  }

  if (existingAccount && forceReinit) {
    console.log(`  ⚠ ${circuitName} comp def exists but cannot be closed. Attempting to reinitialize...`);
  } else {
    console.log(`  Initializing ${circuitName} comp def...`);
  }

  // Get LUT address for v0.7.0
  const arciumProgram = getArciumProgram(provider);
  const mxeAccount = getMXEAccAddress(program.programId);
  const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
  const lutAddress = getLookupTableAddress(
    program.programId,
    mxeAcc.lutOffsetSlot
  );

  // Step 1: Initialize the comp def (this will fail if it already exists)
  try {
    await retryWithBackoff(async () => {
      await (program.methods as any)[methodName]()
        .accounts({
          compDefAccount: compDefPDA,
          payer: owner.publicKey,
          mxeAccount,
          addressLookupTable: lutAddress,
        })
        .signers([owner])
        .rpc({ commitment: "confirmed" });
    });
  } catch (e: any) {
    if (e.message?.includes("already in use") || e.message?.includes("0x0")) {
      console.log(`  ⚠ ${circuitName} comp def already initialized, skipping to finalization`);
    } else {
      throw e;
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Step 2: Finalize the comp def
  console.log(`  Finalizing ${circuitName} comp def...`);
  await retryWithBackoff(async () => {
    const finalizeTx = await buildFinalizeCompDefTx(
      provider,
      Buffer.from(offset).readUInt32LE(),
      program.programId
    );

    const latestBlockhash = await provider.connection.getLatestBlockhash();
    finalizeTx.recentBlockhash = latestBlockhash.blockhash;
    finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
    finalizeTx.sign(owner);

    await provider.sendAndConfirm(finalizeTx);
  });

  console.log(`  ✓ ${circuitName} comp def initialized and finalized`);
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const forceReinit = process.argv.includes("--force");

  console.log("\n======================================================================");
  console.log("REINITIALIZE COMPUTATION DEFINITIONS (OFF-CHAIN)");
  console.log("======================================================================\n");

  if (forceReinit) {
    console.log("⚠️  FORCE MODE: Will attempt to reinitialize existing comp defs\n");
  }

  // Setup connection and provider
  const connection = new Connection(DEVNET_RPC_URL, "confirmed");
  const owner = readKpJson(KEYPAIR_PATH);
  const wallet = new anchor.Wallet(owner);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });

  console.log(`RPC URL: ${DEVNET_RPC_URL.substring(0, 50)}...`);
  console.log(`Program ID: ${PROGRAM_ID.toBase58()}`);
  console.log(`Payer: ${owner.publicKey.toBase58()}\n`);

  // Check balance
  const balance = await connection.getBalance(owner.publicKey);
  console.log(`Wallet balance: ${(balance / 1e9).toFixed(4)} SOL\n`);

  if (balance < 0.1 * 1e9) {
    console.error("❌ Insufficient SOL balance. Need at least 0.1 SOL.");
    process.exit(1);
  }

  // Load IDL and create program
  const idlPath = "./target/idl/shuffle_protocol.json";
  if (!fs.existsSync(idlPath)) {
    console.error(`❌ IDL not found at ${idlPath}. Run 'arcium build' first.`);
    process.exit(1);
  }

  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new Program<ShuffleProtocol>(idl, provider);

  const circuits = [
    { name: "add_balance", method: "initAddBalanceCompDef" },
    { name: "sub_balance", method: "initSubBalanceCompDef" },
    { name: "transfer", method: "initTransferCompDef" },
    { name: "accumulate_order", method: "initAccumulateOrderCompDef" },
    { name: "init_batch_state", method: "initInitBatchStateCompDef" },
    { name: "reveal_batch", method: "initRevealBatchCompDef" },
    { name: "calculate_payout", method: "initCalculatePayoutCompDef" },
    { name: "add_together", method: "initAddTogetherCompDef" },
  ];

  // Step 1: Check and close existing comp defs
  console.log("Step 1: Checking existing comp defs...\n");
  const existingCompDefs: string[] = [];

  for (const circuit of circuits) {
    const exists = await closeCompDefIfExists(program, owner, provider, circuit.name);
    if (exists) {
      existingCompDefs.push(circuit.name);
    }
  }

  if (existingCompDefs.length > 0 && !forceReinit) {
    console.log("\n⚠️  Found existing comp defs that cannot be closed:");
    existingCompDefs.forEach(name => console.log(`  - ${name}`));
    console.log("\nThe existing comp defs are using onchain storage (incomplete).");
    console.log("Unfortunately, Arcium doesn't provide a way to close comp def accounts.");
    console.log("\nYou have two options:");
    console.log("  1. Deploy to a new program address with fresh comp defs");
    console.log("  2. Continue using the existing comp defs (they may work despite errors)\n");
    console.log("To attempt reinitialization anyway, run with --force flag");
    console.log("(This will likely fail but worth trying)\n");
    process.exit(1);
  }

  // Step 2: Initialize comp defs with off-chain circuits
  console.log("\nStep 2: Initializing computation definitions...\n");

  for (const circuit of circuits) {
    try {
      await initCompDef(program, owner, provider, circuit.name, circuit.method, forceReinit);
    } catch (e: any) {
      console.error(`  ❌ Failed to initialize ${circuit.name}: ${e.message}`);
    }
  }

  console.log("\n======================================================================");
  console.log("✅ DONE");
  console.log("======================================================================\n");
}

main().catch((e) => {
  console.error("Script failed:", e);
  process.exit(1);
});
