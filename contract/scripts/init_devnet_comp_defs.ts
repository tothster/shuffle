/**
 * Devnet Deployment: Initialize Computation Definitions
 * 
 * This script initializes all computation definitions on devnet after program deployment.
 * Run this AFTER `arcium deploy` completes successfully.
 * 
 * Usage:
 *   1. Set DEVNET_RPC_URL and CLUSTER_OFFSET below
 *   2. Run: npx ts-node scripts/init_devnet_comp_defs.ts
 * 
 * Prerequisites:
 *   - Program deployed to devnet with `arcium deploy`
 *   - Sufficient SOL in wallet for transaction fees
 *   - @arcium-hq/client installed
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection, clusterApiUrl } from "@solana/web3.js";
import { 
  getCompDefAccOffset, 
  getMXEAccAddress, 
  getArciumAccountBaseSeed,
  getArciumProgramId,
  buildFinalizeCompDefTx,
} from "@arcium-hq/client";
import { ShuffleProtocol } from "../target/types/shuffle_protocol";
import * as fs from "fs";
import * as os from "os";

// =============================================================================
// CONFIGURATION - Update these values for your deployment
// =============================================================================

/**
 * Your Helius RPC URL for devnet
 */
const DEVNET_RPC_URL = process.env.HELIUS_RPC_URL || "https://devnet.helius-rpc.com/?api-key=YOUR_API_KEY";

/**
 * Arcium cluster offset for v0.6.3
 */
const CLUSTER_OFFSET = 456;

/**
 * Program ID from successful devnet deployment (2026-02-01)
 */
const PROGRAM_ID = new PublicKey("BzaakuSahkVtEXKqZnD9tSPBoiJCMLa1nzQHUjtY1xRM");

/**
 * Path to your Solana keypair
 */
const KEYPAIR_PATH = process.env.KEYPAIR_PATH || `${os.homedir()}/.config/solana/id.json`;

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

async function initCompDef(
  program: Program<ShuffleProtocol>,
  owner: Keypair,
  provider: AnchorProvider,
  circuitName: string,
  methodName: string
): Promise<void> {
  const baseSeedCompDefAcc = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const offset = getCompDefAccOffset(circuitName);

  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
    getArciumProgramId()
  )[0];

  const existingAccount = await provider.connection.getAccountInfo(compDefPDA);
  if (existingAccount) {
    console.log(`  ✓ ${circuitName} comp def already exists`);
    return;
  }

  console.log(`  Initializing ${circuitName} comp def...`);
  
  // Step 1: Initialize the comp def
  await retryWithBackoff(async () => {
    await (program.methods as any)[methodName]()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });
  });

  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Step 2: Finalize the comp def
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
  console.log("\n======================================================================");
  console.log("DEVNET COMPUTATION DEFINITION INITIALIZATION");
  console.log("======================================================================\n");

  // Setup connection and provider
  const connection = new Connection(DEVNET_RPC_URL, "confirmed");
  const owner = readKpJson(KEYPAIR_PATH);
  const wallet = new anchor.Wallet(owner);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });

  console.log(`RPC URL: ${DEVNET_RPC_URL.substring(0, 50)}...`);
  console.log(`Program ID: ${PROGRAM_ID.toBase58()}`);
  console.log(`Payer: ${owner.publicKey.toBase58()}`);
  console.log(`Cluster Offset: ${CLUSTER_OFFSET}\n`);

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

  // Initialize all computation definitions
  console.log("Initializing computation definitions...\n");

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

  for (const circuit of circuits) {
    try {
      await initCompDef(program, owner, provider, circuit.name, circuit.method);
    } catch (e: any) {
      console.error(`  ❌ Failed to initialize ${circuit.name}: ${e.message}`);
      // Continue with other circuits
    }
  }

  console.log("\n======================================================================");
  console.log("✅ COMPUTATION DEFINITIONS INITIALIZATION COMPLETE");
  console.log("======================================================================\n");

  // Show status
  console.log("Next steps:");
  console.log("  1. Initialize pool with token mints");
  console.log("  2. Initialize BatchAccumulator");
  console.log("  3. Call initBatchState to set up encrypted zeros");
  console.log("  4. Update SDK constants with program ID and cluster offset\n");
}

main().catch((e) => {
  console.error("Deployment failed:", e);
  process.exit(1);
});
