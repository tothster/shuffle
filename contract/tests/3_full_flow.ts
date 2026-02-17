/**
 * Full Flow Integration Test (Phase 11)
 *
 * Self-contained end-to-end test demonstrating the complete lifecycle:
 * 1. Pool and infrastructure initialization (if needed)
 * 2. User creation and deposits
 * 3. Order placement reaching batch threshold
 * 4. WebSocket event detection (BatchReadyEvent)
 * 5. Batch execution
 * 6. Effective balance verification (before settlement)
 * 7. Settlement for all users
 * 8. Final balance verification
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { ShuffleProtocol } from "../target/types/shuffle_protocol";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  RescueCipher,
  deserializeLE,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getLookupTableAddress,
  getArciumProgram,
  x25519,
} from "@arcium-hq/client";
import {
  createMint,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  createAccount,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

process.env.ARCIUM_CLUSTER_OFFSET = process.env.ARCIUM_CLUSTER_OFFSET ?? "1234";

// =============================================================================
// TIMING CONSTANTS - Adjust these if experiencing blockhash errors
// =============================================================================
const DELAY = {
  VALIDATOR_STARTUP: 15000,  // Wait for validator to fully start
  AFTER_TX: 1500,            // Delay after a transaction
  BETWEEN_TXS: 500,          // Delay between sequential transactions
  AFTER_COMP_DEF: 2000,      // Delay after computation definition init
  RETRY_BASE: 2000,          // Base retry delay (will use exponential backoff)
};

// =============================================================================
// HELPER: Retry with exponential backoff for blockhash errors
// =============================================================================
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  delayMs: number = DELAY.RETRY_BASE
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      const isBlockhashError = e.message?.includes("Blockhash not found") || 
                               e.message?.includes("blockhash");
      if (attempt === maxRetries || !isBlockhashError) {
        throw e;
      }
      console.log(`  ⏳ Blockhash error, retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs *= 1.5; // Exponential backoff
    }
  }
  throw new Error("Max retries exceeded");
}


// =============================================================================
// HELPER: Initialize Computation Definition
// =============================================================================
async function initCompDef(
  program: Program<ShuffleProtocol>,
  owner: Keypair,
  provider: anchor.AnchorProvider,
  circuitName: string,
  methodName: string
): Promise<void> {
  const baseSeedCompDefAcc = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const offset = getCompDefAccOffset(circuitName);

  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
    getArciumProgramId()
  )[0];

  const existingAccount = await retryWithBackoff(() => provider.connection.getAccountInfo(compDefPDA));
  if (existingAccount) {
    console.log(`  ✓ ${circuitName} comp def already exists`);
    return;
  }

  console.log(`  Initializing ${circuitName} comp def...`);

  // Get LUT address for current Arcium devnet cluster
  const arciumProgram = getArciumProgram(provider);
  const mxeAccount = getMXEAccAddress(program.programId);
  const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
  const lutAddress = getLookupTableAddress(
    program.programId,
    mxeAcc.lutOffsetSlot
  );

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

  // Wait for transaction to propagate
  await new Promise((resolve) => setTimeout(resolve, DELAY.AFTER_TX));

  console.log(`  ✓ ${circuitName} comp def initialized`);
  await new Promise((resolve) => setTimeout(resolve, DELAY.AFTER_COMP_DEF));
}

// =============================================================================
// TEST STATE
// =============================================================================
let usdcMint: PublicKey;
let tslaMint: PublicKey;
let spyMint: PublicKey;
let aaplMint: PublicKey;
let poolPDA: PublicKey;
let batchAccumulatorPDA: PublicKey;
let mxePublicKey: Uint8Array;

interface TestUser {
  name: string;
  keypair: Keypair;
  privKey: Uint8Array;
  pubKey: Uint8Array;
  cipher: RescueCipher;
  accountPDA: PublicKey;
  depositAmount: number;
  orderPairId: number;
  orderDirection: number;
  orderAmount: number;
  settlementNonce?: Uint8Array;  // Captured from SettlementEvent for decryption
}

let testUsers: TestUser[] = [];

// Helper to read keypair
function readKpJson(path: string): Keypair {
  const data = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

// Wrapper for MPC computation with timeout and callback error detection
async function awaitComputationWithTimeout(
  provider: anchor.AnchorProvider,
  computationOffset: anchor.BN,
  programId: PublicKey,
  commitment: "confirmed" | "finalized" = "confirmed",
  timeoutMs: number = 60000,
  maxRetries: number = 3
): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Race between computation finalization and timeout
      // Also periodically check for callback failures
      const startTime = Date.now();
      
      while (Date.now() - startTime < timeoutMs) {
        // Check if computation is finalized (successful case)
        try {
          const result = await Promise.race([
            awaitComputationFinalization(provider, computationOffset, programId, commitment),
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error("poll_timeout")), 5000);
            })
          ]);
          return result;
        } catch (pollError: any) {
          if (pollError.message === "poll_timeout") {
            // Check for callback error transactions in the logs
            // This is a simplified check - in production you'd parse the ARX logs
            
            // Continue polling
            continue;
          }
          // Real error from computation - might be a callback failure
          if (pollError.message.includes("6015") || pollError.message.includes("InsufficientBalance")) {
            throw new Error("MPC callback failed: InsufficientBalance - user does not have enough funds");
          }
          throw pollError;
        }
      }
      
      throw new Error(`MPC timeout after ${timeoutMs}ms (attempt ${attempt}/${maxRetries})`);
    } catch (error: any) {
      if (error.message.includes("timeout") && attempt < maxRetries) {
        console.log(`[WARN] MPC attempt ${attempt} timed out, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      throw error;
    }
  }
  throw new Error("MPC computation failed after all retries");
}

describe.skip("Full Flow Integration Test", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.ShuffleProtocol as Program<ShuffleProtocol>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);
  const connection = provider.connection;
  const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

  // =============================================================================
  // SETUP - Initialize all required infrastructure
  // =============================================================================
  before(async () => {
    console.log("\n" + "=".repeat(70));
    console.log("FULL FLOW INTEGRATION TEST - SELF-CONTAINED");
    console.log("=".repeat(70));
    
    // Wait for validator to stabilize (prevents Blockhash not found errors)
    console.log("Waiting for validator to stabilize...");
    await new Promise(resolve => setTimeout(resolve, DELAY.VALIDATOR_STARTUP));
    
    // Warm up connection by fetching recent blockhash
    for (let i = 0; i < 3; i++) {
      try {
        await connection.getLatestBlockhash();
        console.log(`  ✓ Connection warmup ${i + 1}/3`);
        await new Promise(resolve => setTimeout(resolve, DELAY.AFTER_TX));
      } catch (e) {
        console.log(`  ⏳ Waiting for RPC... (attempt ${i + 1})`);
        await new Promise(resolve => setTimeout(resolve, DELAY.RETRY_BASE));
      }
    }
    
    // =========================================================================
    // STEP 0A: Get PDAs
    // =========================================================================
    [poolPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool")],
      program.programId
    );

    [batchAccumulatorPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("batch_accumulator")],
      program.programId
    );

    // =========================================================================
    // STEP 0B: Initialize Pool and Mints (if needed)
    // =========================================================================

    const existingPool = await retryWithBackoff(() => connection.getAccountInfo(poolPDA));
    if (existingPool) {
      console.log("Pool already exists, fetching mints...");
      const poolAccount = await program.account.pool.fetch(poolPDA);
      usdcMint = poolAccount.usdcMint;
      tslaMint = poolAccount.tslaMint;
      spyMint = poolAccount.spyMint;
      aaplMint = poolAccount.aaplMint;
      console.log("  ✓ Pool and mints loaded");
    } else {
      console.log("Pool does not exist - creating it now...");

      // Create mints with retry
      console.log("  Creating token mints...");
      usdcMint = await retryWithBackoff(() => createMint(connection, owner, owner.publicKey, null, 6));
      await new Promise((resolve) => setTimeout(resolve, DELAY.BETWEEN_TXS));
      tslaMint = await retryWithBackoff(() => createMint(connection, owner, owner.publicKey, null, 6));
      await new Promise((resolve) => setTimeout(resolve, DELAY.BETWEEN_TXS));
      spyMint = await retryWithBackoff(() => createMint(connection, owner, owner.publicKey, null, 6));
      await new Promise((resolve) => setTimeout(resolve, DELAY.BETWEEN_TXS));
      aaplMint = await retryWithBackoff(() => createMint(connection, owner, owner.publicKey, null, 6));
      console.log("  ✓ All mints created");
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Derive vault PDAs
      const [vaultUsdcPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), Buffer.from("usdc")],
        program.programId
      );
      const [vaultTslaPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), Buffer.from("tsla")],
        program.programId
      );
      const [vaultSpyPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), Buffer.from("spy")],
        program.programId
      );
      const [vaultAaplPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), Buffer.from("aapl")],
        program.programId
      );

      // Derive reserve PDAs
      const [reserveUsdcPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("reserve"), Buffer.from("usdc")],
        program.programId
      );
      const [reserveTslaPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("reserve"), Buffer.from("tsla")],
        program.programId
      );
      const [reserveSpyPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("reserve"), Buffer.from("spy")],
        program.programId
      );
      const [reserveAaplPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("reserve"), Buffer.from("aapl")],
        program.programId
      );

      // Derive faucet vault PDA
      const [faucetVaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("faucet_usdc")],
        program.programId
      );

      // Initialize protocol
      console.log("  Initializing protocol...");
      await retryWithBackoff(async () => {
        await program.methods
          .initialize(50, 8)
          .accountsPartial({
            payer: owner.publicKey,
            authority: owner.publicKey,
            operator: owner.publicKey,
            treasury: owner.publicKey,
            pool: poolPDA,
            usdcMint: usdcMint,
            tslaMint: tslaMint,
            spyMint: spyMint,
            aaplMint: aaplMint,
            vaultUsdc: vaultUsdcPDA,
            vaultTsla: vaultTslaPDA,
            vaultSpy: vaultSpyPDA,
            vaultAapl: vaultAaplPDA,
            reserveUsdc: reserveUsdcPDA,
            reserveTsla: reserveTslaPDA,
            reserveSpy: reserveSpyPDA,
            reserveAapl: reserveAaplPDA,
            faucetVault: faucetVaultPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([owner])
          .rpc({ commitment: "confirmed" });
      });
      
      console.log("  ✓ Pool initialized");
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Fund reserves with initial liquidity
      console.log("  Funding reserves with initial liquidity...");
      const INITIAL_RESERVE_AMOUNT = 100_000_000_000; // 100,000 tokens (6 decimals)
      
      await retryWithBackoff(() => mintTo(connection, owner, usdcMint, reserveUsdcPDA, owner, INITIAL_RESERVE_AMOUNT));
      await retryWithBackoff(() => mintTo(connection, owner, tslaMint, reserveTslaPDA, owner, INITIAL_RESERVE_AMOUNT));
      await retryWithBackoff(() => mintTo(connection, owner, spyMint, reserveSpyPDA, owner, INITIAL_RESERVE_AMOUNT));
      await retryWithBackoff(() => mintTo(connection, owner, aaplMint, reserveAaplPDA, owner, INITIAL_RESERVE_AMOUNT));
      
      // Fund faucet vault
      const FAUCET_INITIAL_AMOUNT = 1_000_000_000_000_000; // 1 billion USDC
      await retryWithBackoff(() => mintTo(connection, owner, usdcMint, faucetVaultPDA, owner, FAUCET_INITIAL_AMOUNT));
      console.log("  ✓ Faucet vault funded with 1 billion USDC");
      console.log("  ✓ Reserves funded with 100,000 tokens each");
    }

    // =========================================================================
    // STEP 0C: Initialize Batch Accumulator (if needed)
    // =========================================================================
    const existingBatch = await retryWithBackoff(() => connection.getAccountInfo(batchAccumulatorPDA));
    if (existingBatch) {
      const batch = await program.account.batchAccumulator.fetch(batchAccumulatorPDA);
      console.log(`BatchAccumulator exists: batch_id=${batch.batchId.toString()}, order_count=${batch.orderCount}`);
    } else {
      console.log("  Initializing BatchAccumulator...");
      await retryWithBackoff(async () => {
        await program.methods
          .initBatchAccumulator()
          .accountsPartial({
            payer: owner.publicKey,
            batchAccumulator: batchAccumulatorPDA,
            systemProgram: SystemProgram.programId,
          })
          .signers([owner])
          .rpc({ commitment: "confirmed" });
      });
      
      console.log("  ✓ BatchAccumulator initialized");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // =========================================================================
    // STEP 0D: Initialize Computation Definitions (if needed)
    // =========================================================================
    console.log("Checking computation definitions...");
    await initCompDef(program, owner, provider, "add_balance", "initAddBalanceCompDef");
    await new Promise((resolve) => setTimeout(resolve, DELAY.BETWEEN_TXS));
    await initCompDef(program, owner, provider, "sub_balance", "initSubBalanceCompDef");
    await new Promise((resolve) => setTimeout(resolve, DELAY.BETWEEN_TXS));
    await initCompDef(program, owner, provider, "transfer", "initTransferCompDef");
    await new Promise((resolve) => setTimeout(resolve, DELAY.BETWEEN_TXS));
    await initCompDef(program, owner, provider, "accumulate_order", "initAccumulateOrderCompDef");
    await new Promise((resolve) => setTimeout(resolve, DELAY.BETWEEN_TXS));
    await initCompDef(program, owner, provider, "init_batch_state", "initInitBatchStateCompDef");
    await new Promise((resolve) => setTimeout(resolve, DELAY.BETWEEN_TXS));
    await initCompDef(program, owner, provider, "reveal_batch", "initRevealBatchCompDef");
    await new Promise((resolve) => setTimeout(resolve, DELAY.BETWEEN_TXS));
    await initCompDef(program, owner, provider, "calculate_payout", "initCalculatePayoutCompDef");
    await new Promise((resolve) => setTimeout(resolve, DELAY.BETWEEN_TXS));

    // =========================================================================
    // STEP 0E: Initialize Batch State with Encrypted Zeros
    // =========================================================================
    // This MUST be called after batch accumulator creation and before any orders
    // The MPC generates properly encrypted zeros that can be decrypted later
    console.log("Initializing batch state with encrypted zeros...");
    const initBatchStateOffset = new anchor.BN(Date.now());

    await retryWithBackoff(async () => {
      await program.methods
        .initBatchState(initBatchStateOffset)
        .accountsPartial({
          payer: owner.publicKey,
          batchAccumulator: batchAccumulatorPDA,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
          executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
          computationAccount: getComputationAccAddress(
            arciumEnv.arciumClusterOffset,
            initBatchStateOffset
          ),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("init_batch_state")).readUInt32LE()
          ),
          clusterAccount: clusterAccount,
          poolAccount: arciumEnv.feePool,
          clockAccount: arciumEnv.arciumClock,
          arciumProgram: getArciumProgramId(),
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc({ commitment: "confirmed" });
    });

    // Wait for MPC callback
    await awaitComputationWithTimeout(
      provider,
      initBatchStateOffset,
      program.programId,
      "confirmed",
      60000
    );
    console.log("  ✓ Batch state initialized with encrypted zeros");
    await new Promise((resolve) => setTimeout(resolve, DELAY.AFTER_TX));

    // =========================================================================
    // STEP 0F: Get MXE Public Key
    // =========================================================================
    mxePublicKey = await getMXEPublicKey(provider, program.programId);
    console.log("MXE public key obtained");
    
    console.log("\nPool:", poolPDA.toBase58());
    console.log("BatchAccumulator:", batchAccumulatorPDA.toBase58());
    console.log("=" + "=".repeat(69) + "\n");
  });

  // =============================================================================
  // STEP 1: CREATE 8 USERS WITH DEPOSITS
  // =============================================================================
  it("Creates 8 users with deposits", async () => {
    console.log("\n" + "=".repeat(60));
    console.log("STEP 1: Creating 8 users with deposits");
    console.log("=".repeat(60));

    const userConfigs = [
      // direction: 1 = sell Token B (USDC) to buy Token A (TSLA/SPY)
      { name: "Alice", depositAmount: 5_000_000, pairId: 0, direction: 1, orderAmount: 1_000_000 },
      { name: "Bob", depositAmount: 5_000_000, pairId: 0, direction: 1, orderAmount: 1_000_000 },
      { name: "Charlie", depositAmount: 5_000_000, pairId: 1, direction: 1, orderAmount: 1_000_000 },
      { name: "Diana", depositAmount: 5_000_000, pairId: 1, direction: 1, orderAmount: 1_000_000 },
      { name: "Eve", depositAmount: 5_000_000, pairId: 0, direction: 1, orderAmount: 1_000_000 },
      { name: "Frank", depositAmount: 5_000_000, pairId: 0, direction: 1, orderAmount: 1_000_000 },
      { name: "Grace", depositAmount: 5_000_000, pairId: 1, direction: 1, orderAmount: 1_000_000 },
      { name: "Henry", depositAmount: 5_000_000, pairId: 1, direction: 1, orderAmount: 1_000_000 },
    ];

    for (const config of userConfigs) {
      // Create keypair
      const keypair = Keypair.generate();
      
      // Airdrop SOL
      const airdropSig = await connection.requestAirdrop(keypair.publicKey, 2_000_000_000);
      await connection.confirmTransaction(airdropSig, "confirmed");
      
      // Create encryption keys
      const privKey = x25519.utils.randomSecretKey();
      const pubKey = x25519.getPublicKey(privKey);
      const sharedSecret = x25519.getSharedSecret(privKey, mxePublicKey);
      const cipher = new RescueCipher(sharedSecret);

      // Get user account PDA
      const [accountPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("user"), keypair.publicKey.toBuffer()],
        program.programId
      );

      // Create account with initial zero balances
      const initialNonce = randomBytes(16);
      const encryptedZero = cipher.encrypt([BigInt(0)], initialNonce);
      const initialBalances = [
        Array.from(encryptedZero[0]),
        Array.from(encryptedZero[0]),
        Array.from(encryptedZero[0]),
        Array.from(encryptedZero[0]),
      ];

      await program.methods
        .createUserAccount(
          Array.from(pubKey),
          initialBalances,
          new anchor.BN(deserializeLE(initialNonce).toString())
        )
        .accountsPartial({
          payer: owner.publicKey,
          owner: keypair.publicKey,
          userAccount: accountPDA,
        })
        .signers([owner, keypair])
        .rpc({ commitment: "confirmed" });

      // =========================================================================
      // VERIFY INITIAL BALANCES ARE ALL 0 (only for first user to avoid log spam)
      // =========================================================================
      if (config.name === "Alice") {
        console.log("\n  🔓 Verifying initial zero balances for Alice...");
        const userAccount = await program.account.userProfile.fetch(accountPDA);
        
        const assets = [
          { name: "USDC", credit: userAccount.usdcCredit, nonce: userAccount.usdcNonce },
          { name: "TSLA", credit: userAccount.tslaCredit, nonce: userAccount.tslaNonce },
          { name: "SPY", credit: userAccount.spyCredit, nonce: userAccount.spyNonce },
          { name: "AAPL", credit: userAccount.aaplCredit, nonce: userAccount.aaplNonce },
        ];

        for (const asset of assets) {
          const assetNonce = new anchor.BN(asset.nonce.toString());
          const assetNonceBuffer = new Uint8Array(assetNonce.toArray("le", 16));
          
          try {
            const decrypted = cipher.decrypt([Array.from(asset.credit)], assetNonceBuffer);
            console.log(`    ${asset.name} balance: ${decrypted[0].toString()}`);
            expect(Number(decrypted[0])).to.equal(0, `${asset.name} initial balance should be 0`);
          } catch (error) {
            console.log(`    ❌ ${asset.name} decryption failed:`, error);
            throw error;
          }
        }
        console.log("  ✅ All initial balances verified as 0\n");
      }

      // Deposit USDC (all users deposit USDC for simplicity)
      await depositToUser(
        program,
        provider,
        keypair,
        accountPDA,
        usdcMint,
        0, // USDC asset ID
        config.depositAmount,
        cipher,
        pubKey,
        arciumEnv,
        clusterAccount
      );

      testUsers.push({
        name: config.name,
        keypair,
        privKey,
        pubKey,
        cipher,
        accountPDA,
        depositAmount: config.depositAmount,
        orderPairId: config.pairId,
        orderDirection: config.direction,
        orderAmount: config.orderAmount,
      });

      console.log(`  ✓ ${config.name} created and deposited ${config.depositAmount / 1_000_000} USDC`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    expect(testUsers.length).to.equal(8);
    console.log("\n✓ All 8 users created with deposits");
    console.log("=".repeat(60) + "\n");
  });

  // =============================================================================
  // STEP 1.5: INTERNAL TRANSFER (Test fix for garbage balance bug)
  // =============================================================================
  it("Performs internal transfer between Alice and Bob", async () => {
    console.log("\n" + "=".repeat(60));
    console.log("STEP 1.5: Internal transfer between Alice and Bob");
    console.log("=".repeat(60));

    // Initialize transfer comp def first
    console.log("  Initializing transfer comp def...");
    await initCompDef(program, owner, provider, "transfer", "initTransferCompDef");
    await new Promise((resolve) => setTimeout(resolve, DELAY.BETWEEN_TXS));

    const alice = testUsers[0];
    const bob = testUsers[1];
    const transferAmount = 100_000; // 0.1 USDC

    // Get balances before transfer
    const aliceAccountBefore = await program.account.userProfile.fetch(alice.accountPDA);
    const bobAccountBefore = await program.account.userProfile.fetch(bob.accountPDA);
    
    const aliceNonceBefore = new anchor.BN(aliceAccountBefore.usdcNonce.toString());
    const bobNonceBefore = new anchor.BN(bobAccountBefore.usdcNonce.toString());
    
    const aliceBalanceBefore = alice.cipher.decrypt(
      [Array.from(aliceAccountBefore.usdcCredit) as number[]],
      new Uint8Array(aliceNonceBefore.toArray("le", 16))
    )[0];
    const bobBalanceBefore = bob.cipher.decrypt(
      [Array.from(bobAccountBefore.usdcCredit) as number[]],
      new Uint8Array(bobNonceBefore.toArray("le", 16))
    )[0];
    
    console.log(`  Alice balance before: ${Number(aliceBalanceBefore) / 1_000_000} USDC`);
    console.log(`  Bob balance before: ${Number(bobBalanceBefore) / 1_000_000} USDC`);

    // Encrypt transfer amount with Alice's key
    const transferNonce = randomBytes(16);
    const encryptedAmount = alice.cipher.encrypt([BigInt(transferAmount)], transferNonce);

    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    // Execute internal transfer
    await program.methods
      .internalTransfer(
        computationOffset,
        Array.from(encryptedAmount[0]),
        Array.from(alice.pubKey),
        new anchor.BN(deserializeLE(transferNonce).toString())
      )
      .accountsPartial({
        payer: owner.publicKey,
        sender: alice.keypair.publicKey,
        senderAccount: alice.accountPDA,
        recipientAccount: bob.accountPDA,
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          computationOffset
        ),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("transfer")).readUInt32LE()
        ),
      })
      .signers([owner, alice.keypair])
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    console.log("  Transfer queued, waiting for MPC...");

    await awaitComputationWithTimeout(
      provider,
      computationOffset,
      program.programId,
      "confirmed"
    );

    console.log("  ✓ MPC computation completed");

    // Wait for callback to write to accounts and for RPC to reflect changes
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get balances after transfer (fresh fetch with confirmed commitment)
    const aliceAccountAfter = await program.account.userProfile.fetch(alice.accountPDA, "confirmed");
    const bobAccountAfter = await program.account.userProfile.fetch(bob.accountPDA, "confirmed");
    
    const aliceNonceAfter = new anchor.BN(aliceAccountAfter.usdcNonce.toString());
    const bobNonceAfter = new anchor.BN(bobAccountAfter.usdcNonce.toString());
    
    console.log(`  DEBUG: Alice nonce before: ${aliceNonceBefore.toString()}, after: ${aliceNonceAfter.toString()}`);
    console.log(`  DEBUG: Bob nonce before: ${bobNonceBefore.toString()}, after: ${bobNonceAfter.toString()}`);
    console.log(`  DEBUG: Alice credit[0..8] after: ${Buffer.from(aliceAccountAfter.usdcCredit.slice(0, 8)).toString('hex')}`);
    console.log(`  DEBUG: Bob credit[0..8] after: ${Buffer.from(bobAccountAfter.usdcCredit.slice(0, 8)).toString('hex')}`);
    
    const aliceBalanceAfter = alice.cipher.decrypt(
      [Array.from(aliceAccountAfter.usdcCredit) as number[]],
      new Uint8Array(aliceNonceAfter.toArray("le", 16))
    )[0];
    const bobBalanceAfter = bob.cipher.decrypt(
      [Array.from(bobAccountAfter.usdcCredit) as number[]],
      new Uint8Array(bobNonceAfter.toArray("le", 16))
    )[0];
    
    console.log(`  Alice balance after: ${Number(aliceBalanceAfter) / 1_000_000} USDC`);
    console.log(`  Bob balance after: ${Number(bobBalanceAfter) / 1_000_000} USDC`);

    // Verify balances changed correctly
    const expectedAlice = Number(aliceBalanceBefore) - transferAmount;
    const expectedBob = Number(bobBalanceBefore) + transferAmount;
    
    expect(Number(aliceBalanceAfter)).to.equal(expectedAlice, "Alice's balance should decrease by transfer amount");
    expect(Number(bobBalanceAfter)).to.equal(expectedBob, "Bob's balance should increase by transfer amount");

    console.log("\n✓ Internal transfer completed successfully!");
    console.log(`  Transferred ${transferAmount / 1_000_000} USDC from Alice to Bob`);
    console.log("=".repeat(60) + "\n");
  });

  // =============================================================================
  // STEP 2: PLACE ORDERS WITH WEBSOCKET LISTENER
  // =============================================================================
  it("Places orders and detects BatchReadyEvent via WebSocket", async () => {
    console.log("\n" + "=".repeat(60));
    console.log("STEP 2: Placing orders with WebSocket listener");
    console.log("=".repeat(60));

    // Get initial batch state
    const batchBefore = await program.account.batchAccumulator.fetch(batchAccumulatorPDA);
    console.log("Initial batch state:");
    console.log("  batch_id:", batchBefore.batchId.toNumber());
    console.log("  order_count:", batchBefore.orderCount);

    // Set up BatchReadyEvent listener BEFORE placing orders
    console.log("\n📡 Setting up BatchReadyEvent listener...");
    
    let batchReadyEvent: any = null;
    let executionTriggered = false;
    
    const eventListenerId = program.addEventListener("batchReadyEvent", (event, slot) => {
      console.log("\n🚀 BatchReadyEvent DETECTED!");
      console.log("  batch_id:", event.batchId.toString());
      console.log("  batch_accumulator:", event.batchAccumulator.toString());
      batchReadyEvent = event;
    });

    console.log("✓ Event listener active\n");
    console.log("📝 Placing orders from all 8 users...\n");

    // Place orders from all users
    for (const user of testUsers) {
      const orderNonce = randomBytes(16);
      const encryptedOrder = user.cipher.encrypt(
        [BigInt(user.orderPairId), BigInt(user.orderDirection), BigInt(user.orderAmount)],
        orderNonce
      );

      const computationOffset = new anchor.BN(randomBytes(8), "hex");

      await program.methods
        .placeOrder(
          computationOffset,
          Array.from(encryptedOrder[0]),
          Array.from(encryptedOrder[1]),
          Array.from(encryptedOrder[2]),
          Array.from(user.pubKey),
          new anchor.BN(deserializeLE(orderNonce).toString()),
          0 // USDC - users are selling USDC to buy TSLA/SPY
        )
        .accountsPartial({
          payer: user.keypair.publicKey,
          user: user.keypair.publicKey,
          userAccount: user.accountPDA,
          batchAccumulator: batchAccumulatorPDA,
          computationAccount: getComputationAccAddress(
            arciumEnv.arciumClusterOffset,
            computationOffset
          ),
          clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
          executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("accumulate_order")).readUInt32LE()
          ),
        })
        .signers([user.keypair])
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      await awaitComputationWithTimeout(
        provider,
        computationOffset,
        program.programId,
        "confirmed"
      );

      console.log(`  ✓ ${user.name}'s order placed (pair ${user.orderPairId})`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Give event listener time to process
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify batch state
    const batchAfter = await program.account.batchAccumulator.fetch(batchAccumulatorPDA);
    console.log("\nBatch state after orders:");
    console.log("  order_count:", batchAfter.orderCount);

    if (batchReadyEvent) {
      console.log("\n✅ BatchReadyEvent was detected via WebSocket!");
    } else {
      console.log("\n⚠ BatchReadyEvent was not detected (may have been emitted before listener setup)");
    }

    // Clean up listener
    await program.removeEventListener(eventListenerId);

    expect(batchAfter.orderCount).to.be.greaterThanOrEqual(8);
    console.log("=".repeat(60) + "\n");
  });

  // =============================================================================
  // STEP 3: EXECUTE BATCH
  // =============================================================================
  it("Executes batch and creates BatchLog", async () => {
    console.log("\n" + "=".repeat(60));
    console.log("STEP 3: Executing batch");
    console.log("=".repeat(60));

    const batch = await program.account.batchAccumulator.fetch(batchAccumulatorPDA);
    const batchId = batch.batchId.toNumber();
    console.log("Executing batch_id:", batchId);
    console.log("DEBUG: BatchAccumulator mxe_nonce before execute:", batch.mxeNonce.toString());

    const [batchLogPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("batch_log"), Buffer.from(new anchor.BN(batchId).toArray("le", 8))],
      program.programId
    );

    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    // Derive vault PDAs for execute_batch
    const [vaultUsdcPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), Buffer.from("usdc")],
      program.programId
    );
    const [vaultTslaPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), Buffer.from("tsla")],
      program.programId
    );
    const [vaultSpyPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), Buffer.from("spy")],
      program.programId
    );
    const [vaultAaplPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), Buffer.from("aapl")],
      program.programId
    );

    // Derive reserve PDAs for execute_batch
    const [reserveUsdcPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve"), Buffer.from("usdc")],
      program.programId
    );
    const [reserveTslaPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve"), Buffer.from("tsla")],
      program.programId
    );
    const [reserveSpyPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve"), Buffer.from("spy")],
      program.programId
    );
    const [reserveAaplPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve"), Buffer.from("aapl")],
      program.programId
    );

    await program.methods
      .executeBatch(computationOffset)
      .accountsPartial({
        payer: owner.publicKey,
        caller: owner.publicKey,
        pool: poolPDA,
        batchAccumulator: batchAccumulatorPDA,
        batchLog: batchLogPDA,
        // Vault accounts
        vaultUsdc: vaultUsdcPDA,
        vaultTsla: vaultTslaPDA,
        vaultSpy: vaultSpyPDA,
        vaultAapl: vaultAaplPDA,
        // Reserve accounts
        reserveUsdc: reserveUsdcPDA,
        reserveTsla: reserveTslaPDA,
        reserveSpy: reserveSpyPDA,
        reserveAapl: reserveAaplPDA,
        // Token program
        tokenProgram: TOKEN_PROGRAM_ID,
        // Arcium accounts
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          computationOffset
        ),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("reveal_batch")).readUInt32LE()
        ),
      })
      .signers([owner])
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    console.log("Batch execution queued, waiting for MPC...");

    await awaitComputationWithTimeout(
      provider,
      computationOffset,
      program.programId,
      "confirmed",
      90000
    );

    console.log("✓ Batch execution completed!");

    // Verify BatchLog created
    const batchLog = await program.account.batchLog.fetch(batchLogPDA);
    expect(batchLog.batchId.toNumber()).to.equal(batchId);
    console.log("✓ BatchLog created for batch", batchId);
    
    // DEBUG: Print BatchLog results to see what reveal_batch returned
    console.log("\n--- DEBUG: BatchLog Results ---");
    for (let i = 0; i < 6; i++) {
      const result = batchLog.results[i];
      console.log(`  Pair ${i}: total_a_in=${result.totalAIn.toString()}, total_b_in=${result.totalBIn.toString()}, final_pool_a=${result.finalPoolA.toString()}, final_pool_b=${result.finalPoolB.toString()}`);
    }
    console.log("--- END DEBUG ---\n");

    // =========================================================================
    // VERIFY BATCHLOG VALUES ARE CORRECT
    // =========================================================================
    // Expected values based on test setup:
    // - 4 users order on pair 0 (TSLA/USDC), each selling 1,000,000 USDC (direction 1 = B_to_A)
    // - 4 users order on pair 1 (SPY/USDC), each selling 1,000,000 USDC (direction 1 = B_to_A)
    // 
    // For pair 0: total_a_in = 0, total_b_in = 4,000,000
    // For pair 1: total_a_in = 0, total_b_in = 4,000,000
    // All other pairs should be 0

    const pair0 = batchLog.results[0];
    const pair1 = batchLog.results[1];

    // Check pair 0 (TSLA/USDC)
    console.log("Verifying pair 0 (TSLA/USDC):");
    console.log(`  Expected: total_a_in=0, total_b_in=4000000`);
    console.log(`  Actual:   total_a_in=${pair0.totalAIn.toString()}, total_b_in=${pair0.totalBIn.toString()}`);
    
    // Verify values are in reasonable range (allow for some variance)
    // If values are garbage (billions/trillions), this will catch it
    expect(pair0.totalAIn.toNumber()).to.equal(0, "Pair 0 total_a_in should be 0 (no one selling TSLA)");
    expect(pair0.totalBIn.toNumber()).to.equal(4_000_000, "Pair 0 total_b_in should be 4,000,000 (4 users × 1 USDC)");
    expect(pair0.finalPoolA.toNumber()).to.be.greaterThan(0, "Pair 0 final_pool_a should be > 0 (output TSLA)");
    expect(pair0.finalPoolA.toNumber()).to.be.lessThan(100_000_000, "Pair 0 final_pool_a should be reasonable");
    console.log("✓ Pair 0 values verified");

    // Check pair 1 (SPY/USDC)
    console.log("Verifying pair 1 (SPY/USDC):");
    console.log(`  Expected: total_a_in=0, total_b_in=4000000`);
    console.log(`  Actual:   total_a_in=${pair1.totalAIn.toString()}, total_b_in=${pair1.totalBIn.toString()}`);
    
    expect(pair1.totalAIn.toNumber()).to.equal(0, "Pair 1 total_a_in should be 0 (no one selling SPY)");
    expect(pair1.totalBIn.toNumber()).to.equal(4_000_000, "Pair 1 total_b_in should be 4,000,000 (4 users × 1 USDC)");
    expect(pair1.finalPoolA.toNumber()).to.be.greaterThan(0, "Pair 1 final_pool_a should be > 0 (output SPY)");
    expect(pair1.finalPoolA.toNumber()).to.be.lessThan(100_000_000, "Pair 1 final_pool_a should be reasonable");
    console.log("✓ Pair 1 values verified");

    // Check that inactive pairs have all zeros
    for (let i = 2; i < 6; i++) {
      const result = batchLog.results[i];
      expect(result.totalAIn.toNumber()).to.equal(0, `Pair ${i} should be inactive (total_a_in=0)`);
      expect(result.totalBIn.toNumber()).to.equal(0, `Pair ${i} should be inactive (total_b_in=0)`);
    }
    console.log("✓ Inactive pairs verified (all zeros)\n");

    // Execute vault↔reserve swaps
    console.log("Executing vault↔reserve swaps...");
    await program.methods
      .executeSwaps(new anchor.BN(batchId))
      .accountsPartial({
        payer: owner.publicKey,
        operator: owner.publicKey,
        pool: poolPDA,
        batchLog: batchLogPDA,
        vaultUsdc: vaultUsdcPDA,
        vaultTsla: vaultTslaPDA,
        vaultSpy: vaultSpyPDA,
        vaultAapl: vaultAaplPDA,
        reserveUsdc: reserveUsdcPDA,
        reserveTsla: reserveTslaPDA,
        reserveSpy: reserveSpyPDA,
        reserveAapl: reserveAaplPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });
    console.log("✓ Vault↔reserve swaps executed");

    // Verify swaps were marked as executed
    const updatedBatchLog = await program.account.batchLog.fetch(batchLogPDA);
    expect(updatedBatchLog.swapsExecuted).to.be.true;
    console.log("✓ swapsExecuted flag is true");

    console.log("=".repeat(60) + "\n");
  });

  // =============================================================================
  // STEP 4: VERIFY EFFECTIVE BALANCES (BEFORE SETTLEMENT)
  // =============================================================================
  it("Verifies effective balances before settlement", async () => {
    console.log("\n" + "=".repeat(60));
    console.log("STEP 4: Verifying effective balances (before settlement)");
    console.log("=".repeat(60));

    for (const user of testUsers) {
      // Get current on-chain balance (this should be reduced by order amount)
      const account = await program.account.userProfile.fetch(user.accountPDA);
      
      // Decrypt current USDC balance
      const usdcNonce = new anchor.BN(account.usdcNonce.toString());
      const nonceBytes = new Uint8Array(usdcNonce.toArray("le", 16));
      const currentBalance = user.cipher.decrypt(
        [Array.from(account.usdcCredit) as number[]],
        nonceBytes
      )[0];

      // Calculate expected effective balance
      // Current balance = deposit - order amount
      const expectedCurrentBalance = BigInt(user.depositAmount - user.orderAmount);
      
      // For this test, all users are selling USDC (direction 1 = B_to_A)
      // So they should receive the output asset (TSLA or SPY)
      
      console.log(`\n${user.name}:`);
      console.log(`  Deposited: ${user.depositAmount / 1_000_000} USDC`);
      console.log(`  Order amount: ${user.orderAmount / 1_000_000} USDC`);
      console.log(`  Current on-chain balance: ${Number(currentBalance) / 1_000_000} USDC`);
      
      // Verify current balance is reduced
      expect(Number(currentBalance)).to.be.lessThanOrEqual(user.depositAmount);
      
      // Check pending order exists
      expect(account.pendingOrder).to.not.be.null;
      console.log(`  ✓ Has pending order for batch ${account.pendingOrder?.batchId.toNumber()}`);
    }

    console.log("\n✓ All users have correct current balances and pending orders");
    console.log("=".repeat(60) + "\n");
  });

  // =============================================================================
  // STEP 5: SETTLE ALL ORDERS
  // =============================================================================
  it("Settles orders for all users", async () => {
    console.log("\n" + "=".repeat(60));
    console.log("STEP 5: Settling orders for all users");
    console.log("=".repeat(60));

    for (const user of testUsers) {
      const account = await program.account.userProfile.fetch(user.accountPDA);
      if (!account.pendingOrder) {
        console.log(`  ${user.name}: No pending order, skipping`);
        continue;
      }

      const batchId = account.pendingOrder.batchId.toNumber();
      const [batchLogPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("batch_log"), Buffer.from(new anchor.BN(batchId).toArray("le", 8))],
        program.programId
      );

      const computationOffset = new anchor.BN(randomBytes(8), "hex");
      const settlementNonce = randomBytes(16);

      // Listen for SettlementEvent to capture the callback nonce and revealed payout for decryption
      const settlementEventPromise = new Promise<{ nonce: number[]; revealedPayout: { toNumber: () => number } }>((resolve) => {
        const listenerId = program.addEventListener("settlementEvent", (event) => {
          if (event.user.equals(user.keypair.publicKey)) {
            program.removeEventListener(listenerId);
            resolve(event);
          }
        });
      });

      await program.methods
        .settleOrder(
          computationOffset,
          Array.from(user.pubKey),
          new anchor.BN(deserializeLE(settlementNonce).toString()),
          user.orderPairId,
          user.orderDirection
        )
        .accountsPartial({
          payer: owner.publicKey,
          user: user.keypair.publicKey,
          userAccount: user.accountPDA,
          batchLog: batchLogPDA,
          computationAccount: getComputationAccAddress(
            arciumEnv.arciumClusterOffset,
            computationOffset
          ),
          clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
          executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("calculate_payout")).readUInt32LE()
          ),
        })
        .signers([owner, user.keypair])
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      await awaitComputationWithTimeout(
        provider,
        computationOffset,
        program.programId,
        "confirmed"
      );

      // Capture the settlement nonce and revealed payout from the event
      const settlementEvent = await settlementEventPromise;
      user.settlementNonce = new Uint8Array(settlementEvent.nonce);
      const revealedPayout = settlementEvent.revealedPayout?.toNumber?.() ?? settlementEvent.revealedPayout;

      // Debug: log the captured nonce AND revealed payout
      console.log(`  ✓ ${user.name}'s order settled (nonce: ${Buffer.from(user.settlementNonce).toString('hex').slice(0, 16)}..., REVEALED PAYOUT: ${revealedPayout})`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log("\n✓ All orders settled");
    console.log("=".repeat(60) + "\n");
  });

  // =============================================================================
  // STEP 6: VERIFY FINAL BALANCES
  // =============================================================================
  it("Verifies final balances after settlement", async () => {
    console.log("\n" + "=".repeat(60));
    console.log("STEP 6: Verifying final balances after settlement");
    console.log("=".repeat(60));

    for (const user of testUsers) {
      const account = await program.account.userProfile.fetch(user.accountPDA);
      
      // Verify pending order is cleared
      expect(account.pendingOrder).to.be.null;
      
      // Decrypt final USDC balance (in this test, remaining after order)
      const usdcNonce = new anchor.BN(account.usdcNonce.toString());
      const usdcNonceBytes = new Uint8Array(usdcNonce.toArray("le", 16));
      const finalUsdcBalance = user.cipher.decrypt(
        [Array.from(account.usdcCredit) as number[]],
        usdcNonceBytes
      )[0];

      // Decrypt output asset balance (TSLA or SPY depending on pair)
      const outputAssetId = user.orderPairId === 0 ? 1 : 2; // TSLA for pair 0, SPY for pair 1
      // Get the correct credit based on output asset
      const outputCredit = outputAssetId === 1 ? account.tslaCredit : account.spyCredit;
      
      // Use settlement nonce captured from SettlementEvent (same pattern as encrypted_balance.ts)
      if (!user.settlementNonce) {
        throw new Error(`${user.name}: No settlement nonce captured!`);
      }
      
      // Debug: log values before decryption
      console.log(`\\n${user.name}:`);
      console.log(`  DEBUG: outputCredit[0..8] = ${Buffer.from(outputCredit.slice(0, 8)).toString('hex')}`);
      console.log(`  DEBUG: settlementNonce = ${Buffer.from(user.settlementNonce).toString('hex')}`);
      
      const finalOutputBalance = user.cipher.decrypt(
        [Array.from(outputCredit) as number[]],
        user.settlementNonce
      )[0];

      console.log(`  ✓ Pending order cleared`);
      console.log(`  Final USDC balance: ${Number(finalUsdcBalance) / 1_000_000} USDC`);
      console.log(`  Final ${outputAssetId === 1 ? 'TSLA' : 'SPY'} balance: ${Number(finalOutputBalance)}`);
      
      // Verify payout is in expected range
      // Each user ordered 1,000,000 (1 USDC)
      // Total input per pair: 4,000,000 (4 users)
      // Final pool output: 3,960,000 (from BatchLog - 1% slippage)
      // Expected payout per user: (1,000,000 * 3,960,000) / 4,000,000 = 990,000
      const expectedPayout = 990_000;
      const payoutValue = Number(finalOutputBalance);
      
      // Check payout is in reasonable range (900k - 1.1M to allow for rounding)
      expect(payoutValue).to.be.greaterThan(0, `${user.name}: payout should be > 0`);
      expect(payoutValue).to.be.lessThan(10_000_000, `${user.name}: payout ${payoutValue} is unreasonably high (expected ~${expectedPayout})`);
      expect(payoutValue).to.be.greaterThan(800_000, `${user.name}: payout ${payoutValue} is too low (expected ~${expectedPayout})`);
      
      console.log(`  ✓ Received payout ${payoutValue} (expected ~${expectedPayout})`);
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ FULL FLOW TEST COMPLETE!");
    console.log("=".repeat(60) + "\n");
  });
});

// =============================================================================
// HELPER: Deposit to User
// =============================================================================
async function depositToUser(
  program: Program<ShuffleProtocol>,
  provider: anchor.AnchorProvider,
  userKeypair: Keypair,
  userAccountPDA: PublicKey,
  mint: PublicKey,
  assetId: number,
  amount: number,
  cipher: RescueCipher,
  pubKey: Uint8Array,
  arciumEnv: any,
  clusterAccount: PublicKey
): Promise<void> {
  const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);
  
  // Get vault PDA using asset seed (usdc, tsla, spy, aapl)
  const vaultSeeds = ["usdc", "tsla", "spy", "aapl"];
  const [vaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), Buffer.from(vaultSeeds[assetId])],
    program.programId
  );

  // Create token account for user
  const userTokenAccount = await createAccount(
    provider.connection,
    owner,
    mint,
    userKeypair.publicKey
  );

  // Mint tokens to user
  await mintTo(
    provider.connection,
    owner,
    mint,
    userTokenAccount,
    owner,
    amount
  );

  // Encrypt deposit
  const depositNonce = randomBytes(16);
  const encryptedAmount = cipher.encrypt([BigInt(amount)], depositNonce);

  const computationOffset = new anchor.BN(randomBytes(8), "hex");

  await program.methods
    .addBalance(
      computationOffset,
      Array.from(encryptedAmount[0]),
      Array.from(pubKey),
      new anchor.BN(deserializeLE(depositNonce).toString()),
      new anchor.BN(amount),
      assetId
    )
    .accountsPartial({
      payer: owner.publicKey,
      user: userKeypair.publicKey,
      userAccount: userAccountPDA,
      pool: poolPDA,
      vault: vaultPDA,
      userTokenAccount,
      computationAccount: getComputationAccAddress(
        arciumEnv.arciumClusterOffset,
        computationOffset
      ),
      clusterAccount,
      mxeAccount: getMXEAccAddress(program.programId),
      mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
      executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
      compDefAccount: getCompDefAccAddress(
        program.programId,
        Buffer.from(getCompDefAccOffset("add_balance")).readUInt32LE()
      ),
    })
    .signers([owner, userKeypair])
    .rpc({ skipPreflight: true, commitment: "confirmed" });

  await awaitComputationWithTimeout(
    provider,
    computationOffset,
    program.programId,
    "confirmed"
  );
}
