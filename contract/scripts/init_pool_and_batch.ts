/**
 * Initialize Pool and BatchAccumulator on Devnet
 *
 * This script initializes:
 * 1. Pool with token mints
 * 2. BatchAccumulator
 * 3. Batch state with encrypted zeros
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import { ShuffleProtocol } from "../target/types/shuffle_protocol";
import * as fs from "fs";
import * as os from "os";

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEVNET_RPC_URL = "https://devnet.helius-rpc.com/?api-key=a8e1a5ce-29c6-4356-b3f9-54c1c650ac08";
const PROGRAM_ID = new PublicKey("J5B3CHigkr6Tiz9iRACMNk355uY5wFpVCq6847urV3Et");
const KEYPAIR_PATH = `${os.homedir()}/.config/solana/id.json`;

// Token mints (reusing existing ones)
const TOKEN_MINTS = {
  USDC: new PublicKey("2rGgkS8piPnFbJxLhyyfXnTuLqPW8zPoM7YXnovjBK9s"),
  TSLA: new PublicKey("EmRuN3yRqizBKwVSahm6bPW4YEUZ4iGcP95SQg1MdDfZ"),
  SPY: new PublicKey("HgaWt2CGQLT3RTNt4HQpCFhMpeo8amadH6KcQ5gVCDvQ"),
  AAPL: new PublicKey("7JohqPXEVJ3Mm8TrHf7KQ7F4Nq4JnxvfTLQFn4D5nghj"),
};

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

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log("\n======================================================================");
  console.log("INITIALIZE POOL AND BATCH ACCUMULATOR");
  console.log("======================================================================\n");

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

  // Step 1: Initialize Pool
  console.log("Step 1: Initializing Pool...\n");
  console.log(`  USDC mint: ${TOKEN_MINTS.USDC.toBase58()}`);
  console.log(`  TSLA mint: ${TOKEN_MINTS.TSLA.toBase58()}`);
  console.log(`  SPY mint: ${TOKEN_MINTS.SPY.toBase58()}`);
  console.log(`  AAPL mint: ${TOKEN_MINTS.AAPL.toBase58()}\n`);

  try {
    await retryWithBackoff(async () => {
      const executionFeeBps = 10; // 0.1% execution fee
      const executionTriggerCount = 5; // Trigger execution after 5 orders

      const tx = await program.methods
        .initialize(executionFeeBps, executionTriggerCount)
        .accounts({
          payer: owner.publicKey,
          authority: owner.publicKey,
          operator: owner.publicKey,
          treasury: owner.publicKey,
          usdcMint: TOKEN_MINTS.USDC,
          tslaMint: TOKEN_MINTS.TSLA,
          spyMint: TOKEN_MINTS.SPY,
          aaplMint: TOKEN_MINTS.AAPL,
        })
        .signers([owner])
        .rpc({ commitment: "confirmed" });

      console.log(`  ✓ Pool initialized`);
      console.log(`  Transaction: ${tx}\n`);
    });
  } catch (e: any) {
    if (e.message?.includes("already in use") || e.message?.includes("0x0")) {
      console.log(`  ✓ Pool already initialized\n`);
    } else {
      console.error(`  ❌ Failed to initialize pool: ${e.message}\n`);
      throw e;
    }
  }

  // Step 2: Initialize BatchAccumulator
  console.log("Step 2: Initializing BatchAccumulator...\n");

  try {
    await retryWithBackoff(async () => {
      const tx = await program.methods
        .initBatchAccumulator()
        .accounts({
          payer: owner.publicKey,
        })
        .signers([owner])
        .rpc({ commitment: "confirmed" });

      console.log(`  ✓ BatchAccumulator initialized`);
      console.log(`  Transaction: ${tx}\n`);
    });
  } catch (e: any) {
    if (e.message?.includes("already in use") || e.message?.includes("0x0")) {
      console.log(`  ✓ BatchAccumulator already initialized\n`);
    } else {
      console.error(`  ❌ Failed to initialize BatchAccumulator: ${e.message}\n`);
      throw e;
    }
  }

  // Step 3: Initialize Batch State (encrypted zeros)
  console.log("Step 3: Initializing Batch State (encrypted zeros)...\n");
  console.log("  This will trigger an MPC computation to create encrypted zero values.\n");

  try {
    await retryWithBackoff(async () => {
      const computationOffset = Date.now(); // Use timestamp as unique offset
      const tx = await program.methods
        .initBatchState(new anchor.BN(computationOffset))
        .accounts({
          payer: owner.publicKey,
        })
        .signers([owner])
        .rpc({ commitment: "confirmed" });

      console.log(`  ✓ Batch state initialization started`);
      console.log(`  Transaction: ${tx}`);
      console.log(`  Computation offset: ${computationOffset}\n`);
      console.log(`  ⏳ The MPC computation will complete asynchronously.`);
      console.log(`  ⏳ Check back in a few minutes for the callback to finalize.\n`);
    });
  } catch (e: any) {
    console.error(`  ❌ Failed to initialize batch state: ${e.message}\n`);
    console.error("  This might be expected if batch state is already initialized.");
    console.error("  You can continue with the deployment.\n");
  }

  console.log("======================================================================");
  console.log("✅ INITIALIZATION COMPLETE");
  console.log("======================================================================\n");

  console.log("Next steps:");
  console.log("  1. Wait for batch state MPC computation to complete (check logs)");
  console.log("  2. Test the protocol with deposits and orders");
  console.log("  3. Update frontend/SDK if needed\n");
}

main().catch((e) => {
  console.error("Initialization failed:", e);
  process.exit(1);
});
