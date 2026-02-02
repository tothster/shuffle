/**
 * Minimal Localnet Setup for SDK Testing
 * 
 * This script initializes just the essential components:
 * - Token mints (USDC, TSLA, SPY, AAPL)
 * - Pool, vaults, reserves
 * - BatchAccumulator
 * - Computation definitions (including sub_balance and transfer)
 * 
 * Run with: npx ts-mocha -p ./tsconfig.json -t 300000 'tests/0_sdk_setup.ts'
 * 
 * After this, you can run SDK tests against the localnet.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, mintTo } from "@solana/spl-token";
import { 
  getCompDefAccOffset, 
  getMXEAccAddress, 
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  buildFinalizeCompDefTx,
  getArciumEnv,
  getMXEPublicKey,
} from "@arcium-hq/client";
import { ShuffleProtocol } from "../target/types/shuffle_protocol";
import * as fs from "fs";
import * as os from "os";

// =============================================================================
// HELPER: Retry with exponential backoff
// =============================================================================
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  delayMs: number = 2000
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
      delayMs *= 1.5;
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

  const existingAccount = await provider.connection.getAccountInfo(compDefPDA);
  if (existingAccount) {
    console.log(`  ✓ ${circuitName} comp def already exists`);
    return;
  }

  console.log(`  Initializing ${circuitName} comp def...`);
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

  await new Promise((resolve) => setTimeout(resolve, 1500));

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
  
  console.log(`  ✓ ${circuitName} comp def initialized`);
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

// Read keypair helper
function readKpJson(path: string): Keypair {
  const data = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

describe("SDK Localnet Setup", function() {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.ShuffleProtocol as Program<ShuffleProtocol>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const connection = provider.connection;
  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);
  const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

  // Token mints
  let usdcMint: PublicKey;
  let tslaMint: PublicKey;
  let spyMint: PublicKey;
  let aaplMint: PublicKey;

  // PDAs
  let poolPDA: PublicKey;
  let batchAccumulatorPDA: PublicKey;

  before(async function() {
    console.log("\n======================================================================");
    console.log("SDK LOCALNET SETUP");
    console.log("======================================================================");
    console.log(`Program ID: ${program.programId.toBase58()}`);
    console.log(`Payer: ${owner.publicKey.toBase58()}`);

    // Calculate PDAs
    [poolPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool")],
      program.programId
    );
    [batchAccumulatorPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("batch_accumulator")],
      program.programId
    );

    // Wait for validator
    console.log("Waiting for validator...");
    await new Promise(r => setTimeout(r, 5000));
  });

  it("Initializes pool with mints and vaults", async function() {
    // Check if pool already exists
    const poolInfo = await connection.getAccountInfo(poolPDA);
    if (poolInfo) {
      console.log("  ✓ Pool already exists, fetching mints...");
      const poolAccount = await program.account.pool.fetch(poolPDA);
      usdcMint = poolAccount.usdcMint;
      tslaMint = poolAccount.tslaMint;
      spyMint = poolAccount.spyMint;
      aaplMint = poolAccount.aaplMint;
      console.log(`  ✓ USDC: ${usdcMint.toBase58()}`);
      return;
    }

    console.log("\n  Creating token mints...");
    usdcMint = await retryWithBackoff(() => createMint(connection, owner, owner.publicKey, null, 6));
    await new Promise(r => setTimeout(r, 500));
    tslaMint = await retryWithBackoff(() => createMint(connection, owner, owner.publicKey, null, 6));
    await new Promise(r => setTimeout(r, 500));
    spyMint = await retryWithBackoff(() => createMint(connection, owner, owner.publicKey, null, 6));
    await new Promise(r => setTimeout(r, 500));
    aaplMint = await retryWithBackoff(() => createMint(connection, owner, owner.publicKey, null, 6));

    console.log(`  ✓ USDC: ${usdcMint.toBase58()}`);
    console.log(`  ✓ TSLA: ${tslaMint.toBase58()}`);
    console.log(`  ✓ SPY:  ${spyMint.toBase58()}`);
    console.log(`  ✓ AAPL: ${aaplMint.toBase58()}`);

    // Derive vault PDAs
    const [vaultUsdcPDA] = PublicKey.findProgramAddressSync([Buffer.from("vault"), Buffer.from("usdc")], program.programId);
    const [vaultTslaPDA] = PublicKey.findProgramAddressSync([Buffer.from("vault"), Buffer.from("tsla")], program.programId);
    const [vaultSpyPDA] = PublicKey.findProgramAddressSync([Buffer.from("vault"), Buffer.from("spy")], program.programId);
    const [vaultAaplPDA] = PublicKey.findProgramAddressSync([Buffer.from("vault"), Buffer.from("aapl")], program.programId);

    // Derive reserve PDAs
    const [reserveUsdcPDA] = PublicKey.findProgramAddressSync([Buffer.from("reserve"), Buffer.from("usdc")], program.programId);
    const [reserveTslaPDA] = PublicKey.findProgramAddressSync([Buffer.from("reserve"), Buffer.from("tsla")], program.programId);
    const [reserveSpyPDA] = PublicKey.findProgramAddressSync([Buffer.from("reserve"), Buffer.from("spy")], program.programId);
    const [reserveAaplPDA] = PublicKey.findProgramAddressSync([Buffer.from("reserve"), Buffer.from("aapl")], program.programId);

    console.log("\n  Initializing pool...");
    await retryWithBackoff(async () => {
      await program.methods
        .initialize(50, 8) // feeRate, minOrdersToExecute
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
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc({ commitment: "confirmed" });
    });

    console.log("  ✓ Pool initialized");
    await new Promise(r => setTimeout(r, 2000));

    // Fund reserves with initial liquidity
    console.log("\n  Funding reserves...");
    const RESERVE_AMOUNT = 100_000_000_000; // 100,000 tokens
    await retryWithBackoff(() => mintTo(connection, owner, usdcMint, reserveUsdcPDA, owner, RESERVE_AMOUNT));
    await retryWithBackoff(() => mintTo(connection, owner, tslaMint, reserveTslaPDA, owner, RESERVE_AMOUNT));
    await retryWithBackoff(() => mintTo(connection, owner, spyMint, reserveSpyPDA, owner, RESERVE_AMOUNT));
    await retryWithBackoff(() => mintTo(connection, owner, aaplMint, reserveAaplPDA, owner, RESERVE_AMOUNT));
    console.log("  ✓ Reserves funded with 100,000 tokens each");
  });

  it("Initializes BatchAccumulator", async function() {
    const accInfo = await connection.getAccountInfo(batchAccumulatorPDA);
    if (accInfo) {
      console.log("  ✓ BatchAccumulator already exists");
      return;
    }

    console.log("\n  Initializing BatchAccumulator...");
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

    console.log(`  ✓ BatchAccumulator at ${batchAccumulatorPDA.toBase58()}`);
  });

  it("Initializes computation definitions", async function() {
    console.log("\n  Initializing MPC computation definitions...");

    // All comp defs needed for SDK operations
    await initCompDef(program, owner, provider, "add_balance", "initAddBalanceCompDef");
    await initCompDef(program, owner, provider, "sub_balance", "initSubBalanceCompDef");
    await initCompDef(program, owner, provider, "transfer", "initTransferCompDef");
    await initCompDef(program, owner, provider, "accumulate_order", "initAccumulateOrderCompDef");
    await initCompDef(program, owner, provider, "init_batch_state", "initInitBatchStateCompDef");
    await initCompDef(program, owner, provider, "reveal_batch", "initRevealBatchCompDef");
    await initCompDef(program, owner, provider, "calculate_payout", "initCalculatePayoutCompDef");
  });

  it("Initializes batch state with encrypted zeros", async function() {
    const accData = await program.account.batchAccumulator.fetch(batchAccumulatorPDA);
    // Check if batch state was already initialized by looking at mxe_nonce
    // mxe_nonce is 0 until init_batch_state callback sets it
    // Note: batchId starts at 1, so we can't use batchId > 0 as the check
    const mxeNonce = accData.mxeNonce.toString();
    if (mxeNonce !== "0") {
      console.log(`  ✓ Batch state already initialized (mxe_nonce: ${mxeNonce})`);
      return;
    }

    console.log("\n  Initializing batch state...");
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
          poolAccount: (arciumEnv as any).feePool,
          clockAccount: (arciumEnv as any).arciumClock,
          arciumProgram: getArciumProgramId(),
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc({ skipPreflight: true, commitment: "confirmed" });
    });

    // Wait for MPC callback
    console.log("  Waiting for MPC callback...");
    await new Promise(r => setTimeout(r, 5000));

    console.log("  ✓ Batch state initialized");
  });

  // =============================================================================
  // CREATE 7 TEST USERS WITH UNIQUE KEYS
  // =============================================================================
  it("Creates 7 test users with unique encryption keys and deposits", async function() {
    this.timeout(300000); // 5 min timeout for user creation
    
    console.log("\n" + "=".repeat(60));
    console.log("CREATING 7 TEST USERS WITH UNIQUE ENCRYPTION KEYS");
    console.log("=".repeat(60));

    // Import crypto libraries dynamically
    const { x25519 } = await import("@noble/curves/ed25519");
    const { RescueCipher } = await import("@arcium-hq/client");
    const { createAccount } = await import("@solana/spl-token");
    const { randomBytes } = await import("crypto");

    // Get MXE public key for encryption
    const mxePublicKey = await getMXEPublicKey(provider, program.programId);
    console.log("  MXE public key obtained");

    // Helper to deserialize nonce
    const deserializeLE = (arr: Uint8Array): bigint => {
      let result = BigInt(0);
      for (let i = arr.length - 1; i >= 0; i--) {
        result = (result << BigInt(8)) + BigInt(arr[i]);
      }
      return result;
    };

    // Get pool to find USDC mint
    const poolAccount = await program.account.pool.fetch(poolPDA);
    const usdcMintAddr = poolAccount.usdcMint;
    console.log(`  USDC Mint: ${usdcMintAddr.toBase58()}`);

    // 7 users with unique encryption keys and order configs
    // pairId: 0=TSLA/USDC, 1=SPY/USDC
    // direction: 1 = sell USDC to buy TSLA/SPY
    const userConfigs = [
      { name: "Alice", depositAmount: 10_000_000, pairId: 0, direction: 1, orderAmount: 2_000_000 },   // 10 USDC, order 2
      { name: "Bob", depositAmount: 5_000_000, pairId: 0, direction: 1, orderAmount: 1_000_000 },     // 5 USDC, order 1
      { name: "Charlie", depositAmount: 8_000_000, pairId: 0, direction: 1, orderAmount: 1_500_000 }, // 8 USDC, order 1.5
      { name: "Diana", depositAmount: 6_000_000, pairId: 1, direction: 1, orderAmount: 1_200_000 },   // 6 USDC, order 1.2 SPY
      { name: "Eve", depositAmount: 4_000_000, pairId: 1, direction: 1, orderAmount: 800_000 },       // 4 USDC, order 0.8 SPY
      { name: "Frank", depositAmount: 7_000_000, pairId: 0, direction: 1, orderAmount: 1_800_000 },   // 7 USDC, order 1.8
      { name: "Grace", depositAmount: 5_500_000, pairId: 1, direction: 1, orderAmount: 1_100_000 },   // 5.5 USDC, order 1.1 SPY
    ];

    console.log(`\n  Creating ${userConfigs.length} users...\n`);

    // Store created users for order placement
    const createdUsers: Array<{
      name: string;
      keypair: Keypair;
      pubKey: Uint8Array;
      cipher: any;
      accountPDA: PublicKey;
      pairId: number;
      direction: number;
      orderAmount: number;
    }> = [];

    for (let i = 0; i < userConfigs.length; i++) {
      const config = userConfigs[i];
      console.log(`  [${i + 1}/${userConfigs.length}] Creating ${config.name}...`);

      // 1. Generate new Solana keypair
      const userKeypair = Keypair.generate();
      console.log(`      Wallet: ${userKeypair.publicKey.toBase58().slice(0, 20)}...`);

      // 2. Airdrop SOL for transactions
      const airdropSig = await connection.requestAirdrop(userKeypair.publicKey, 2_000_000_000);
      await connection.confirmTransaction(airdropSig, "confirmed");
      console.log(`      ✓ Airdropped 2 SOL`);

      // 3. Generate unique encryption keypair (x25519)
      const privKey = x25519.utils.randomPrivateKey();
      const pubKey = x25519.getPublicKey(privKey);
      const sharedSecret = x25519.getSharedSecret(privKey, mxePublicKey);
      const cipher = new RescueCipher(sharedSecret);
      console.log(`      ✓ Encryption keys generated`);

      // 4. Derive user account PDA
      const [userAccountPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("user"), userKeypair.publicKey.toBuffer()],
        program.programId
      );

      // 5. Create privacy account with encrypted zero balances
      const initialNonce = randomBytes(16);
      const encryptedZero = cipher.encrypt([BigInt(0)], initialNonce);
      const initialBalances = [
        Array.from(encryptedZero[0]),
        Array.from(encryptedZero[0]),
        Array.from(encryptedZero[0]),
        Array.from(encryptedZero[0]),
      ];

      await retryWithBackoff(async () => {
        await program.methods
          .createUserAccount(
            Array.from(pubKey),
            initialBalances,
            new anchor.BN(deserializeLE(initialNonce).toString())
          )
          .accountsPartial({
            payer: owner.publicKey,
            owner: userKeypair.publicKey,
            userAccount: userAccountPDA,
            systemProgram: SystemProgram.programId,
          })
          .signers([owner, userKeypair])
          .rpc({ commitment: "confirmed" });
      });
      console.log(`      ✓ Privacy account created`);

      // 6. Create token account and mint USDC
      const userTokenAccount = await createAccount(
        connection,
        owner,
        usdcMintAddr,
        userKeypair.publicKey
      );

      await retryWithBackoff(() => 
        mintTo(connection, owner, usdcMintAddr, userTokenAccount, owner, config.depositAmount)
      );
      console.log(`      ✓ Minted ${config.depositAmount / 1_000_000} USDC`);

      // 7. Deposit USDC into privacy account
      const [vaultUsdcPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), Buffer.from("usdc")],
        program.programId
      );

      const depositNonce = randomBytes(16);
      const encryptedAmount = cipher.encrypt([BigInt(config.depositAmount)], depositNonce);
      const computationOffset = new anchor.BN(Date.now() + i * 1000);

      await retryWithBackoff(async () => {
        await program.methods
          .addBalance(
            computationOffset,
            Array.from(encryptedAmount[0]),
            Array.from(pubKey),
            new anchor.BN(deserializeLE(depositNonce).toString()),
            new anchor.BN(config.depositAmount),
            0 // USDC asset ID
          )
          .accountsPartial({
            payer: owner.publicKey,
            user: userKeypair.publicKey,
            userAccount: userAccountPDA,
            pool: poolPDA,
            vault: vaultUsdcPDA,
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
      });

      console.log(`      ✓ Deposited ${config.depositAmount / 1_000_000} USDC to privacy account`);
      console.log(`      ✓ ${config.name} ready!\n`);

      // Small delay between users to avoid rate limiting
      await new Promise(r => setTimeout(r, 2000));

      // Store user data for order placement
      createdUsers.push({
        name: config.name,
        keypair: userKeypair,
        pubKey,
        cipher,
        accountPDA: userAccountPDA,
        pairId: config.pairId,
        direction: config.direction,
        orderAmount: config.orderAmount,
      });
    }

    console.log("  " + "=".repeat(55));
    console.log(`  ✅ ALL ${userConfigs.length} USERS CREATED AND FUNDED`);
    console.log("  " + "=".repeat(55));
    console.log("\n  User Summary:");
    for (const config of userConfigs) {
      console.log(`    • ${config.name.padEnd(8)} - ${(config.depositAmount / 1_000_000).toFixed(1)} USDC`);
    }
    console.log();

    // =========================================================================
    // PLACE ORDERS FOR ALL 7 USERS
    // =========================================================================
    console.log("\n" + "=".repeat(60));
    console.log("PLACING ORDERS FOR 7 USERS");
    console.log("=".repeat(60) + "\n");

    for (const user of createdUsers) {
      console.log(`  Placing order for ${user.name}...`);
      
      const orderNonce = randomBytes(16);
      const encryptedOrder = user.cipher.encrypt(
        [BigInt(user.pairId), BigInt(user.direction), BigInt(user.orderAmount)],
        orderNonce
      );

      const computationOffset = new anchor.BN(Date.now());

      await retryWithBackoff(async () => {
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
      });

      const pairLabel = user.pairId === 0 ? "TSLA/USDC" : "SPY/USDC";
      console.log(`    ✓ ${user.name}: ${(user.orderAmount / 1_000_000).toFixed(1)} USDC → ${pairLabel}`);
      
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log("\n  " + "=".repeat(55));
    console.log(`  ✅ ALL ${createdUsers.length} ORDERS PLACED`);
    console.log("  " + "=".repeat(55) + "\n");
  });

  after(function() {
    console.log("\n======================================================================");
    console.log("✅ SDK LOCALNET SETUP COMPLETE WITH 7 TEST USERS");
    console.log("======================================================================");
    console.log(`\nYou can now run SDK tests:`);
    console.log(`  cd ../sdk && npx ts-node tests/sdk_integration.ts`);
    console.log(`\nProgram ID: ${program.programId.toBase58()}`);
    console.log("======================================================================\n");
  });
});
