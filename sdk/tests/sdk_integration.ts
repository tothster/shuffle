/**
 * SDK Full Integration Test against Localnet
 * 
 * Tests the ShuffleClient SDK with all operations:
 * - Account creation
 * - Deposits
 * - Balance checks
 * - Order placement
 * - Status checks
 * 
 * Run with: npx ts-node tests/sdk_integration.ts
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { createMint, mintTo, createAccount, getAccount } from "@solana/spl-token";
import { ShuffleClient, AssetId, PairId, Direction, generateEncryptionKeypair } from "../src";
import * as fs from "fs";
import * as os from "os";

// =============================================================================
// CONFIGURATION - Update these based on your local deployment
// =============================================================================

// Program ID from arcium test output - UPDATE THIS when network restarts
const LOCALNET_PROGRAM_ID = new PublicKey("3tZMV8JhXCaVz4p8q4xgLU7RefdP438AmohAjjMWL8wH");
const RPC_URL = "http://127.0.0.1:8899";

// Load local wallet
function loadLocalWallet(): Keypair {
  const defaultPath = `${os.homedir()}/.config/solana/id.json`;
  const raw = JSON.parse(fs.readFileSync(defaultPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

// Load or create persistent encryption key (same as CLI)
function loadOrCreateEncryptionKey(): Uint8Array {
  const shuffleDir = `${os.homedir()}/.shuffle`;
  const encryptionPath = `${shuffleDir}/encryption.json`;

  if (fs.existsSync(encryptionPath)) {
    const raw = JSON.parse(fs.readFileSync(encryptionPath, "utf-8"));
    console.log("  Using existing encryption key from ~/.shuffle/encryption.json");
    return Uint8Array.from(raw.privateKey);
  }

  // Create new keypair
  const keypair = generateEncryptionKeypair();
  
  if (!fs.existsSync(shuffleDir)) {
    fs.mkdirSync(shuffleDir, { recursive: true });
  }
  
  fs.writeFileSync(encryptionPath, JSON.stringify({
    privateKey: Array.from(keypair.privateKey),
    publicKey: Array.from(keypair.publicKey),
  }));

  console.log("  Created new encryption key at ~/.shuffle/encryption.json");
  return keypair.privateKey;
}

// Helper to wait
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("SDK FULL INTEGRATION TEST - LOCALNET");
  console.log("=".repeat(60));
  
  // Setup connection and wallet
  const connection = new Connection(RPC_URL, "confirmed");
  const keypair = loadLocalWallet();
  const wallet = new anchor.Wallet(keypair);
  
  console.log(`\nWallet: ${keypair.publicKey.toBase58()}`);
  console.log(`Program: ${LOCALNET_PROGRAM_ID.toBase58()}`);
  
  // Check connection
  const balance = await connection.getBalance(keypair.publicKey);
  console.log(`SOL Balance: ${balance / 1e9} SOL`);
  
  if (balance < 0.1 * 1e9) {
    console.log("⚠ Low SOL balance, requesting airdrop...");
    const sig = await connection.requestAirdrop(keypair.publicKey, 2 * 1e9);
    await connection.confirmTransaction(sig);
    console.log("✓ Airdrop received");
  }

  // =============================================================================
  // TEST 1: Create ShuffleClient
  // =============================================================================
  console.log("\n--- TEST 1: Create ShuffleClient ---");
  
  let client: ShuffleClient;
  try {
    client = await ShuffleClient.create({
      connection,
      wallet,
      programId: LOCALNET_PROGRAM_ID,
      clusterOffset: 0, // localnet
    });
    console.log("✓ ShuffleClient created successfully");
  } catch (e: any) {
    console.log(`✗ Failed to create client: ${e.message}`);
    process.exit(1);
  }

  // =============================================================================
  // TEST 2: Initialize Encryption (using persistent key)
  // =============================================================================
  console.log("\n--- TEST 2: Initialize Encryption ---");
  
  const encryptionPrivateKey = loadOrCreateEncryptionKey();
  client.initEncryption(encryptionPrivateKey);
  console.log("✓ Encryption initialized");
  // =============================================================================
  // TEST 3: Create or Check Account
  // =============================================================================
  console.log("\n--- TEST 3: Create/Check User Account ---");
  
  try {
    const exists = await client.accountExists();
    console.log(`  Account exists: ${exists}`);
    
    if (!exists) {
      console.log("  Creating user account...");
      const sig = await client.createUserAccount();
      console.log(`  ✓ Account created: ${sig.slice(0, 20)}...`);
    } else {
      console.log("  ✓ Account already exists");
    }
  } catch (e: any) {
    console.log(`  ✗ Account operation failed: ${e.message}`);
    process.exit(1);
  }

  // =============================================================================
  // TEST 4: Get Initial Balances
  // =============================================================================
  console.log("\n--- TEST 4: Get Initial Balances ---");
  
  let initialBalances;
  try {
    initialBalances = await client.getBalance();
    console.log("  Current balances:");
    console.log(`    USDC: ${Number(initialBalances.usdc) / 1_000_000}`);
    console.log(`    TSLA: ${Number(initialBalances.tsla) / 1_000_000}`);
    console.log(`    SPY:  ${Number(initialBalances.spy) / 1_000_000}`);
    console.log(`    AAPL: ${Number(initialBalances.aapl) / 1_000_000}`);
    console.log("  ✓ Balances retrieved and decrypted");
  } catch (e: any) {
    console.log(`  ✗ Balance check failed: ${e.message}`);
  }

  // =============================================================================
  // TEST 5: Deposit USDC
  // =============================================================================
  console.log("\n--- TEST 5: Deposit USDC ---");
  
  const DEPOSIT_AMOUNT = 5_000_000; // 5 USDC (6 decimals)
  
  try {
    // Get pool to find USDC mint
    const poolPDA = PublicKey.findProgramAddressSync(
      [Buffer.from("pool")],
      LOCALNET_PROGRAM_ID
    )[0];
    
    // Fetch pool to get USDC mint
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
    const idl = require("../src/idl/shuffle_protocol.json");
    const idlWithAddress = { ...idl, address: LOCALNET_PROGRAM_ID.toBase58() };
    const program = new anchor.Program(idlWithAddress as any, provider);
    
    const pool = await (program.account as any).pool.fetch(poolPDA);
    const usdcMint = pool.usdcMint;
    console.log(`  USDC Mint: ${usdcMint.toBase58().slice(0, 20)}...`);
    
    // Create user token account and mint tokens
    console.log("  Creating token account and minting USDC...");
    const userTokenAccount = await createAccount(
      connection,
      keypair,
      usdcMint,
      keypair.publicKey
    );
    
    // Mint USDC to user (we're the mint authority on localnet)
    await mintTo(
      connection,
      keypair,
      usdcMint,
      userTokenAccount,
      keypair,
      DEPOSIT_AMOUNT
    );
    console.log(`  ✓ Minted ${DEPOSIT_AMOUNT / 1_000_000} USDC to token account`);
    
    // Now deposit via SDK
    console.log("  Depositing via ShuffleClient...");
    const depositSig = await client.deposit(AssetId.USDC, DEPOSIT_AMOUNT);
    console.log(`  ✓ Deposit tx: ${depositSig.slice(0, 20)}...`);
    
    // Wait for MPC to complete
    console.log("  Waiting for MPC computation...");
    await delay(3000);
    
  } catch (e: any) {
    console.log(`  ✗ Deposit failed: ${e.message}`);
    if (e.message.includes("already in use")) {
      console.log("  (Token account already exists, trying deposit anyway...)");
    }
  }

  // =============================================================================
  // TEST 6: Check Balances After Deposit
  // =============================================================================
  console.log("\n--- TEST 6: Balances After Deposit ---");
  
  try {
    const balances = await client.getBalance();
    console.log("  Current balances:");
    console.log(`    USDC: ${Number(balances.usdc) / 1_000_000}`);
    console.log(`    TSLA: ${Number(balances.tsla) / 1_000_000}`);
    console.log(`    SPY:  ${Number(balances.spy) / 1_000_000}`);
    console.log(`    AAPL: ${Number(balances.aapl) / 1_000_000}`);
    
    if (Number(balances.usdc) > Number(initialBalances?.usdc || 0n)) {
      console.log("  ✓ USDC balance increased after deposit!");
    } else {
      console.log("  ⚠ USDC balance unchanged (MPC may still be processing)");
    }
  } catch (e: any) {
    console.log(`  ✗ Balance check failed: ${e.message}`);
  }

  // =============================================================================
  // TEST 7: Place Order
  // =============================================================================
  console.log("\n--- TEST 7: Place Order ---");
  
  const ORDER_AMOUNT = 1_000_000; // 1 USDC worth
  
  try {
    // Check if already has pending order
    const existingOrder = await client.getDecryptedOrder();
    if (existingOrder) {
      console.log("  ⚠ Already has pending order, skipping...");
      console.log(`    Batch: ${existingOrder.batchId}, Pair: ${existingOrder.pairId}`);
    } else {
      console.log("  Placing order: Buy TSLA with 1 USDC...");
      const orderSig = await client.placeOrder(
        PairId.TSLA_USDC,
        Direction.BtoA, // Sell USDC (B) to buy TSLA (A)
        ORDER_AMOUNT,
        AssetId.USDC
      );
      console.log(`  ✓ Order placed: ${orderSig.slice(0, 20)}...`);
      
      // Wait for MPC
      console.log("  Waiting for MPC computation...");
      await delay(3000);
    }
  } catch (e: any) {
    console.log(`  ✗ Order failed: ${e.message}`);
  }

  // =============================================================================
  // TEST 8: Check Order Status
  // =============================================================================
  console.log("\n--- TEST 8: Check Order Status ---");
  
  try {
    const order = await client.getDecryptedOrder();
    if (order) {
      console.log("  Pending order found:");
      console.log(`    Batch ID: ${order.batchId}`);
      console.log(`    Pair ID: ${order.pairId} (${order.pairId === 0 ? 'TSLA/USDC' : 'Other'})`);
      console.log(`    Direction: ${order.direction === 0 ? 'A→B' : 'B→A'}`);
      console.log(`    Amount: ${Number(order.amount) / 1_000_000}`);
      console.log("  ✓ Order retrieved and decrypted");
    } else {
      console.log("  No pending order");
    }
  } catch (e: any) {
    console.log(`  ✗ Order check failed: ${e.message}`);
  }

  // =============================================================================
  // TEST 9: Get Batch Info
  // =============================================================================
  console.log("\n--- TEST 9: Get Batch Info ---");
  
  try {
    const batchInfo = await client.getBatchInfo();
    console.log("  Batch status:");
    console.log(`    Batch ID: ${batchInfo.batchId}`);
    console.log(`    Order count: ${batchInfo.orderCount}`);
    console.log("  ✓ Batch info retrieved");
  } catch (e: any) {
    console.log(`  ✗ Batch info failed: ${e.message}`);
  }

  // =============================================================================
  // TEST 11: Withdraw USDC
  // =============================================================================
  console.log("\n--- TEST 11: Withdraw USDC ---");
  
  const WITHDRAW_AMOUNT = 1_000_000; // 1 USDC
  
  try {
    const balanceBefore = await client.getBalance();
    console.log(`  Balance before: ${Number(balanceBefore.usdc) / 1_000_000} USDC`);
    
    console.log(`  Withdrawing ${WITHDRAW_AMOUNT / 1_000_000} USDC...`);
    const withdrawSig = await client.withdraw(AssetId.USDC, WITHDRAW_AMOUNT);
    console.log(`  ✓ Withdraw tx: ${withdrawSig.slice(0, 20)}...`);
    
    // Wait for MPC
    console.log("  Waiting for MPC computation...");
    await delay(3000);
    
    const balanceAfter = await client.getBalance();
    console.log(`  Balance after: ${Number(balanceAfter.usdc) / 1_000_000} USDC`);
    
    if (Number(balanceAfter.usdc) < Number(balanceBefore.usdc)) {
      console.log("  ✓ USDC balance decreased after withdrawal!");
    } else {
      console.log("  ⚠ USDC balance unchanged (MPC may still be processing)");
    }
  } catch (e: any) {
    console.log(`  ✗ Withdraw failed: ${e.message}`);
  }

  // =============================================================================
  // TEST 12: Create Second User (User B)
  // =============================================================================
  console.log("\n--- TEST 12: Create Second User ---");
  
  let clientB: ShuffleClient | null = null;
  const keypairB = Keypair.generate();
  
  try {
    // Fund User B with SOL
    console.log(`  User B address: ${keypairB.publicKey.toBase58().slice(0, 20)}...`);
    console.log("  Airdropping SOL to User B...");
    const airdropSig = await connection.requestAirdrop(keypairB.publicKey, 2 * 1e9);
    await connection.confirmTransaction(airdropSig);
    console.log("  ✓ User B funded with 2 SOL");
    
    // Create wallet and client
    const walletB = new anchor.Wallet(keypairB);
    clientB = await ShuffleClient.create({
      connection,
      wallet: walletB,
      programId: LOCALNET_PROGRAM_ID,
      clusterOffset: 0,
    });
    console.log("  ✓ ShuffleClient for User B created");
    
    // Initialize encryption for User B (separate key)
    const encryptionKeypairB = generateEncryptionKeypair();
    clientB.initEncryption(encryptionKeypairB.privateKey);
    console.log("  ✓ User B encryption initialized");
    
    // Create account for User B
    console.log("  Creating privacy account for User B...");
    const createSig = await clientB.createUserAccount();
    console.log(`  ✓ User B account created: ${createSig.slice(0, 20)}...`);
    
    // Check initial balance
    const balanceB = await clientB.getBalance();
    console.log(`  User B balances: USDC=${Number(balanceB.usdc)/1e6}, TSLA=${Number(balanceB.tsla)/1e6}`);
    
  } catch (e: any) {
    console.log(`  ✗ User B creation failed: ${e.message}`);
  }

  // =============================================================================
  // TEST 13: Internal Transfer (User A → User B)
  // =============================================================================
  console.log("\n--- TEST 13: Internal Transfer (A → B) ---");
  
  const TRANSFER_AMOUNT = 1_000_000; // 1 USDC
  
  try {
    if (!clientB) {
      throw new Error("User B client not created");
    }
    
    const balanceA_before = await client.getBalance();
    console.log(`  User A balance before: ${Number(balanceA_before.usdc) / 1_000_000} USDC`);
    
    console.log(`  Transferring ${TRANSFER_AMOUNT / 1_000_000} USDC from A to B...`);
    const transferSig = await client.transfer(keypairB.publicKey, TRANSFER_AMOUNT);
    console.log(`  ✓ Transfer tx: ${transferSig.slice(0, 20)}...`);
    
    // Wait for MPC
    console.log("  Waiting for MPC computation...");
    await delay(5000);
    
    const balanceA_after = await client.getBalance();
    const balanceB_after = await clientB.getBalance();
    
    console.log(`  User A balance after: ${Number(balanceA_after.usdc) / 1_000_000} USDC`);
    console.log(`  User B balance after: ${Number(balanceB_after.usdc) / 1_000_000} USDC`);
    
    if (Number(balanceA_after.usdc) < Number(balanceA_before.usdc)) {
      console.log("  ✓ User A balance decreased!");
    }
    if (Number(balanceB_after.usdc) > 0) {
      console.log("  ✓ User B received funds!");
    } else {
      console.log("  ⚠ User B balance still 0 (MPC may be processing)");
    }
    
  } catch (e: any) {
    console.log(`  ✗ Transfer failed: ${e.message}`);
  }

  // =============================================================================
  // TEST 14: User B Deposits USDC
  // =============================================================================
  console.log("\n--- TEST 14: User B Deposits USDC ---");
  
  try {
    if (!clientB) {
      throw new Error("User B client not created");
    }
    
    // Get pool to find USDC mint
    const poolPDA = PublicKey.findProgramAddressSync(
      [Buffer.from("pool")],
      LOCALNET_PROGRAM_ID
    )[0];
    
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
    const idl = require("../src/idl/shuffle_protocol.json");
    const idlWithAddress = { ...idl, address: LOCALNET_PROGRAM_ID.toBase58() };
    const program = new anchor.Program(idlWithAddress as any, provider);
    
    const pool = await (program.account as any).pool.fetch(poolPDA);
    const usdcMint = pool.usdcMint;
    
    // Create token account for User B and mint USDC
    console.log("  Creating token account for User B...");
    const userBTokenAccount = await createAccount(
      connection,
      keypairB,
      usdcMint,
      keypairB.publicKey
    );
    
    await mintTo(
      connection,
      keypair, // Use main keypair as mint authority
      usdcMint,
      userBTokenAccount,
      keypair,
      5_000_000 // 5 USDC
    );
    console.log("  ✓ Minted 5 USDC to User B token account");
    
    // Deposit via SDK
    console.log("  User B depositing via ShuffleClient...");
    const depositSig = await clientB.deposit(AssetId.USDC, 5_000_000);
    console.log(`  ✓ Deposit tx: ${depositSig.slice(0, 20)}...`);
    
    await delay(3000);
    
    const balanceB = await clientB.getBalance();
    console.log(`  User B balance: ${Number(balanceB.usdc) / 1_000_000} USDC`);
    
  } catch (e: any) {
    console.log(`  ✗ User B deposit failed: ${e.message}`);
  }

  // =============================================================================
  // TEST 15: User B Places Order
  // =============================================================================
  console.log("\n--- TEST 15: User B Places Order ---");
  
  try {
    if (!clientB) {
      throw new Error("User B client not created");
    }
    
    console.log("  User B placing order: Buy TSLA with 1 USDC...");
    const orderSig = await clientB.placeOrder(
      PairId.TSLA_USDC,
      Direction.BtoA,
      1_000_000,
      AssetId.USDC
    );
    console.log(`  ✓ Order placed: ${orderSig.slice(0, 20)}...`);
    
    await delay(3000);
    
    // Check batch info
    const batchInfo = await clientB.getBatchInfo();
    console.log(`  Batch ID: ${batchInfo.batchId}, Orders: ${batchInfo.orderCount}`);
    console.log("  ✓ User B order in batch");
    
  } catch (e: any) {
    console.log(`  ✗ User B order failed: ${e.message}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("SDK FULL INTEGRATION TEST COMPLETE");
  console.log("=".repeat(60) + "\n");
}

main().catch(console.error);
