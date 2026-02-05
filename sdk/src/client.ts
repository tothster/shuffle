import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  TokenAccountNotFoundError,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import {
  awaitComputationFinalization,
  getCompDefAccOffset,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  RescueCipher,
} from "@arcium-hq/client";
import { randomBytes } from "crypto";

import { PROGRAM_ID, AssetId, PairId, Direction, VAULT_ASSET_SEEDS } from "./constants";
import {
  getPoolPDA,
  getUserAccountPDA,
  getBatchAccumulatorPDA,
  getBatchLogPDA,
  getVaultPDA,
  getFaucetVaultPDA,
} from "./pda";
import {
  fetchMXEPublicKey,
  createCipher,
  encryptValue,
  decryptValue,
  nonceToBN,
  generateEncryptionKeypair,
} from "./encryption";
import type {
  ShuffleConfig,
  UserBalance,
  OrderInfo,
  DecryptedOrderInfo,
  BatchInfo,
  BatchResult,
  PairResult,
  EstimatedPayout,
  EffectiveBalance,
} from "./types";
import IDL from "./idl/shuffle_protocol.json";

export class ShuffleClient {
  private connection: anchor.web3.Connection;
  private wallet: anchor.Wallet;
  private programId: PublicKey;
  private provider: anchor.AnchorProvider;
  private program: any;
  private mxePublicKey!: Uint8Array;
  private clusterOffset: number;
  private clusterAccount!: PublicKey;

  // Derived PDAs
  private poolPDA!: PublicKey;
  private batchAccumulatorPDA!: PublicKey;

  // Encryption state (set via initEncryption)
  private cipher: RescueCipher | null = null;
  private encryptionPublicKey: Uint8Array | null = null;

  private constructor(config: ShuffleConfig) {
    this.connection = config.connection;
    this.wallet = config.wallet;
    this.programId = config.programId || PROGRAM_ID;
    this.clusterOffset = config.clusterOffset ?? 0; // Default to 0 for localnet
    this.provider = new anchor.AnchorProvider(this.connection, this.wallet, {
      commitment: "confirmed",
      skipPreflight: true,
    });
    // Create a modified IDL with the correct program address
    const idlWithAddress = { ...IDL, address: this.programId.toBase58() };
    this.program = new Program(idlWithAddress as any, this.provider);
  }

  /** Async factory — creates and initializes the client */
  static async create(config: ShuffleConfig): Promise<ShuffleClient> {
    const client = new ShuffleClient(config);
    await client.initialize();
    return client;
  }

  private async initialize(): Promise<void> {
    this.clusterAccount = getClusterAccAddress(this.clusterOffset);
    [this.poolPDA] = getPoolPDA(this.programId);
    [this.batchAccumulatorPDA] = getBatchAccumulatorPDA(this.programId);
    this.mxePublicKey = await fetchMXEPublicKey(this.provider, this.programId);
  }

  /** Get the MXE public key (needed for cipher creation) */
  getMXEPublicKey(): Uint8Array {
    return this.mxePublicKey;
  }

  /** Get the underlying Anchor program */
  getProgram(): Program<any> {
    return this.program;
  }

  /**
   * Initialize encryption from a user's x25519 private key.
   * Creates the cipher and derives the public key.
   * Call this after create() to enable encrypted operations.
   */
  initEncryption(privateKey: Uint8Array): void {
    const keypair = require("@arcium-hq/client").x25519;
    this.encryptionPublicKey = keypair.getPublicKey(privateKey);
    this.cipher = createCipher(privateKey, this.mxePublicKey);
  }

  /** Get the encryption public key (available after initEncryption) */
  getEncryptionPublicKey(): Uint8Array | null {
    return this.encryptionPublicKey;
  }

  /** Get the cipher (available after initEncryption) */
  getCipher(): RescueCipher | null {
    return this.cipher;
  }

  private _requireEncryption(): { cipher: RescueCipher; pubkey: Uint8Array } {
    if (!this.cipher || !this.encryptionPublicKey) {
      throw new Error("Encryption not initialized. Call initEncryption(privateKey) first.");
    }
    return { cipher: this.cipher, pubkey: this.encryptionPublicKey };
  }

  // =========================================================================
  // ACCOUNT METHODS
  // =========================================================================

  /** Create a new user privacy account. Uses internal encryption if initialized. */
  async createUserAccount(encryptionPublicKey?: Uint8Array): Promise<string> {
    const pubkey = encryptionPublicKey || this._requireEncryption().pubkey;
    const enc = this.cipher || createCipher(generateEncryptionKeypair().privateKey, this.mxePublicKey);
    const owner = this.wallet.publicKey;
    const [userAccountPDA] = getUserAccountPDA(this.programId, owner);

    const initialNonce = randomBytes(16);
    const encryptedZero = enc.encrypt([BigInt(0)], initialNonce);
    const initialBalances: number[][] = [
      Array.from(encryptedZero[0]),
      Array.from(encryptedZero[0]),
      Array.from(encryptedZero[0]),
      Array.from(encryptedZero[0]),
    ];

    const sig = await this.program.methods
      .createUserAccount(
        Array.from(pubkey),
        initialBalances,
        nonceToBN(initialNonce)
      )
      .accounts({
        payer: owner,
        owner: owner,
        userAccount: userAccountPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    return sig;
  }

  /** Fetch UserProfile data for an owner */
  async fetchUserAccount(owner?: PublicKey): Promise<any> {
    const target = owner || this.wallet.publicKey;
    const [userAccountPDA] = getUserAccountPDA(this.programId, target);
    return (this.program.account as any).userProfile.fetch(userAccountPDA);
  }

  /** Check if account exists */
  async accountExists(owner?: PublicKey): Promise<boolean> {
    try {
      await this.fetchUserAccount(owner);
      return true;
    } catch {
      return false;
    }
  }

  // =========================================================================
  // DEVNET / FAUCET METHODS
  // =========================================================================

  /**
   * Claim USDC from the program faucet.
   * @param amount Amount in base units (6 decimals).
   */
  async faucet(amount: number): Promise<string> {
    const owner = this.wallet.publicKey;
    const [userAccountPDA] = getUserAccountPDA(this.programId, owner);
    const [faucetVaultPDA] = getFaucetVaultPDA(this.programId);

    // Fetch pool to find the USDC mint
    const pool = await (this.program.account as any).pool.fetch(this.poolPDA);
    const usdcMint = pool.usdcMint as PublicKey;

    // Ensure the user's USDC ATA exists (create if missing)
    const userUsdcAccount = getAssociatedTokenAddressSync(usdcMint, owner);
    try {
      await getAccount(this.connection, userUsdcAccount);
    } catch (e: any) {
      if (e instanceof TokenAccountNotFoundError) {
        const ix = createAssociatedTokenAccountInstruction(
          owner, // payer
          userUsdcAccount,
          owner,
          usdcMint
        );
        const tx = new Transaction().add(ix);
        await this.provider.sendAndConfirm(tx, []);
      } else {
        throw e;
      }
    }

    const sig = await this.program.methods
      .faucet(new anchor.BN(amount))
      .accounts({
        user: owner,
        userAccount: userAccountPDA,
        userUsdcAccount,
        pool: this.poolPDA,
        faucetVault: faucetVaultPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    return sig;
  }

  // =========================================================================
  // BALANCE METHODS
  // =========================================================================

  /** Deposit tokens into the protocol (add_balance). Uses internal encryption if params omitted. */
  async deposit(
    assetId: AssetId,
    amount: number,
    cipher?: RescueCipher,
    encryptionPublicKey?: Uint8Array
  ): Promise<string> {
    const enc = cipher || this._requireEncryption().cipher;
    const pubkey = encryptionPublicKey || this._requireEncryption().pubkey;
    const owner = this.wallet.publicKey;
    const [userAccountPDA] = getUserAccountPDA(this.programId, owner);
    const assetSeed = VAULT_ASSET_SEEDS[assetId];
    const [vaultPDA] = getVaultPDA(this.programId, assetSeed);

    // Get the pool to find the correct mint
    const pool = await (this.program.account as any).pool.fetch(this.poolPDA);
    const mints = [pool.usdcMint, pool.tslaMint, pool.spyMint, pool.aaplMint];
    const mint = mints[assetId];

    // Find user's token account for this mint
    const { getAssociatedTokenAddress } = await import("@solana/spl-token");
    const userTokenAccount = await getAssociatedTokenAddress(mint, owner);

    const nonce = randomBytes(16);
    const encrypted = encryptValue(enc, BigInt(amount), nonce);
    const computationOffset = this._generateComputationOffset();

    const sig = await this.program.methods
      .addBalance(
        computationOffset,
        Array.from(encrypted.ciphertext),
        Array.from(pubkey),
        nonceToBN(nonce),
        new anchor.BN(amount),
        assetId
      )
      .accountsPartial({
        payer: owner,
        user: owner,
        pool: this.poolPDA,
        userAccount: userAccountPDA,
        userTokenAccount,
        vault: vaultPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
        ...this._getArciumAccounts("add_balance", computationOffset),
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    await this._awaitComputation(computationOffset);
    return sig;
  }

  /** Withdraw tokens from the protocol (sub_balance). Uses internal encryption if params omitted. */
  async withdraw(
    assetId: AssetId,
    amount: number,
    cipher?: RescueCipher,
    encryptionPublicKey?: Uint8Array
  ): Promise<string> {
    const enc = cipher || this._requireEncryption().cipher;
    const pubkey = encryptionPublicKey || this._requireEncryption().pubkey;
    const owner = this.wallet.publicKey;
    const [userAccountPDA] = getUserAccountPDA(this.programId, owner);
    const assetSeed = VAULT_ASSET_SEEDS[assetId];
    const [vaultPDA] = getVaultPDA(this.programId, assetSeed);

    const pool = await (this.program.account as any).pool.fetch(this.poolPDA);
    const mints = [pool.usdcMint, pool.tslaMint, pool.spyMint, pool.aaplMint];
    const mint = mints[assetId];

    const { getAssociatedTokenAddress } = await import("@solana/spl-token");
    const recipientTokenAccount = await getAssociatedTokenAddress(mint, owner);

    const nonce = randomBytes(16);
    const encrypted = encryptValue(enc, BigInt(amount), nonce);
    const computationOffset = this._generateComputationOffset();

    const sig = await this.program.methods
      .subBalance(
        computationOffset,
        Array.from(encrypted.ciphertext),
        Array.from(pubkey),
        nonceToBN(nonce),
        new anchor.BN(amount),
        assetId
      )
      .accountsPartial({
        payer: owner,
        user: owner,
        pool: this.poolPDA,
        userAccount: userAccountPDA,
        recipientTokenAccount,
        vault: vaultPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
        ...this._getArciumAccounts("sub_balance", computationOffset),
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    await this._awaitComputation(computationOffset);
    return sig;
  }

  /** Decrypt all 4 asset balances from on-chain account. Uses internal cipher if param omitted. */
  async getBalance(cipher?: RescueCipher, owner?: PublicKey): Promise<UserBalance> {
    const enc = cipher || this._requireEncryption().cipher;
    const account = await this.fetchUserAccount(owner);

    const nonceToBytes = (n: anchor.BN | bigint | number): Uint8Array => {
      const bn = new anchor.BN(n.toString());
      return new Uint8Array(bn.toArray("le", 16));
    };

    return {
      usdc: decryptValue(enc, new Uint8Array(account.usdcCredit), nonceToBytes(account.usdcNonce)),
      tsla: decryptValue(enc, new Uint8Array(account.tslaCredit), nonceToBytes(account.tslaNonce)),
      spy: decryptValue(enc, new Uint8Array(account.spyCredit), nonceToBytes(account.spyNonce)),
      aapl: decryptValue(enc, new Uint8Array(account.aaplCredit), nonceToBytes(account.aaplNonce)),
    };
  }

  /** Get unshielded (normal SPL token) balances from wallet */
  async getUnshieldedBalances(owner?: PublicKey): Promise<UserBalance> {
    const userPubkey = owner || this.wallet.publicKey;
    
    // Fetch pool to get mint addresses
    const poolAccount = await this.program.account.pool.fetch(this.poolPDA);
    const mints = {
      usdc: poolAccount.usdcMint as PublicKey,
      tsla: poolAccount.tslaMint as PublicKey,
      spy: poolAccount.spyMint as PublicKey,
      aapl: poolAccount.aaplMint as PublicKey,
    };

    const getTokenBalance = async (mint: PublicKey): Promise<bigint> => {
      try {
        const ata = getAssociatedTokenAddressSync(mint, userPubkey);
        const account = await getAccount(this.connection, ata);
        return account.amount;
      } catch (e) {
        // Return 0 if account doesn't exist
        if (e instanceof TokenAccountNotFoundError) {
          return BigInt(0);
        }
        throw e;
      }
    };

    const [usdc, tsla, spy, aapl] = await Promise.all([
      getTokenBalance(mints.usdc),
      getTokenBalance(mints.tsla),
      getTokenBalance(mints.spy),
      getTokenBalance(mints.aapl),
    ]);

    return { usdc, tsla, spy, aapl };
  }

  /** Internal P2P transfer (USDC only). Uses internal encryption if params omitted. */
  async transfer(
    recipientPubkey: PublicKey,
    amount: number,
    cipher?: RescueCipher,
    encryptionPublicKey?: Uint8Array
  ): Promise<string> {
    const enc = cipher || this._requireEncryption().cipher;
    const pubkey = encryptionPublicKey || this._requireEncryption().pubkey;
    const sender = this.wallet.publicKey;
    const [senderAccountPDA] = getUserAccountPDA(this.programId, sender);
    const [recipientAccountPDA] = getUserAccountPDA(this.programId, recipientPubkey);

    const nonce = randomBytes(16);
    const encrypted = encryptValue(enc, BigInt(amount), nonce);
    const computationOffset = this._generateComputationOffset();

    const sig = await this.program.methods
      .internalTransfer(
        computationOffset,
        Array.from(encrypted.ciphertext),
        Array.from(pubkey),
        nonceToBN(nonce)
      )
      .accountsPartial({
        payer: sender,
        sender: sender,
        senderAccount: senderAccountPDA,
        recipientAccount: recipientAccountPDA,
        ...this._getArciumAccounts("transfer", computationOffset),
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    await this._awaitComputation(computationOffset);
    return sig;
  }

  // =========================================================================
  // ORDER METHODS
  // =========================================================================

  /**
   * Initialize batch state with encrypted zeros.
   * This must be called before the first order of each new batch.
   * After batch execution, the batch state needs to be re-initialized for the next batch.
   */
  async initBatchState(): Promise<string> {
    const owner = this.wallet.publicKey;
    const computationOffset = this._generateComputationOffset();

    const sig = await this.program.methods
      .initBatchState(computationOffset)
      .accountsPartial({
        payer: owner,
        batchAccumulator: this.batchAccumulatorPDA,
        ...this._getArciumAccounts("init_batch_state", computationOffset),
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    await this._awaitComputation(computationOffset);
    return sig;
  }

  /**
   * Place an encrypted order in the current batch.
   * Automatically initializes batch state if needed (first order of a new batch).
   * Uses internal encryption if params omitted.
   */
  async placeOrder(
    pairId: PairId,
    direction: Direction,
    amount: number,
    sourceAssetId: AssetId,
    cipher?: RescueCipher,
    encryptionPublicKey?: Uint8Array
  ): Promise<string> {
    // Lazy check: If mxe_nonce is 0, batch state needs initialization
    // (mxe_nonce is set by init_batch_state callback, 0 means not yet initialized)
    const batchInfo = await this.getBatchInfo();
    if (batchInfo.mxeNonce === "0") {
      console.log("[SDK] Initializing batch state for new batch...");
      await this.initBatchState();
      console.log("[SDK] Batch state initialized");
    }

    const enc = cipher || this._requireEncryption().cipher;
    const pubkey = encryptionPublicKey || this._requireEncryption().pubkey;
    const owner = this.wallet.publicKey;
    const [userAccountPDA] = getUserAccountPDA(this.programId, owner);

    const orderNonce = randomBytes(16);
    // Encrypt OrderInput struct fields together in a single call
    // The circuit expects Enc<Shared, OrderInput> where OrderInput = { pair_id: u8, direction: u8, amount: u64 }
    const encryptedOrderInput = enc.encrypt(
      [BigInt(pairId), BigInt(direction), BigInt(amount)],
      orderNonce
    );
    const computationOffset = this._generateComputationOffset();

    const sig = await this.program.methods
      .placeOrder(
        computationOffset,
        Array.from(encryptedOrderInput[0]),
        Array.from(encryptedOrderInput[1]),
        Array.from(encryptedOrderInput[2]),
        Array.from(pubkey),
        nonceToBN(orderNonce),
        sourceAssetId
      )
      .accountsPartial({
        payer: owner,
        user: owner,
        userAccount: userAccountPDA,
        batchAccumulator: this.batchAccumulatorPDA,
        ...this._getArciumAccounts("accumulate_order", computationOffset),
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    await this._awaitComputation(computationOffset);
    return sig;
  }

  /** Get current pending order info, or null */
  async getPendingOrder(owner?: PublicKey): Promise<OrderInfo | null> {
    const account = await this.fetchUserAccount(owner);
    if (!account.pendingOrder) return null;

    const order = account.pendingOrder;
    return {
      batchId: order.batchId.toNumber(),
      pairId: Array.from(order.pairId),
      direction: Array.from(order.direction),
      encryptedAmount: Array.from(order.encryptedAmount),
    };
  }

  /**
   * Get decrypted pending order info.
   * Decrypts pairId, direction, and amount using user's cipher.
   * The order nonce is stored on-chain, so no need to save it locally.
   * 
   * @param cipher - Optional cipher (uses internal if omitted)
   * @param owner - Optional owner pubkey (uses wallet if omitted)
   */
  async getDecryptedOrder(
    cipher?: RescueCipher,
    owner?: PublicKey
  ): Promise<DecryptedOrderInfo | null> {
    const enc = cipher || this._requireEncryption().cipher;
    const account = await this.fetchUserAccount(owner);
    if (!account.pendingOrder) return null;

    const order = account.pendingOrder;
    
    // Get the nonce from the on-chain account
    const orderNonce = new anchor.BN(order.orderNonce.toString());
    const nonceBytes = new Uint8Array(orderNonce.toArray("le", 16));
    
    // Decrypt the order fields using the user's cipher
    // Orders are encrypted with Enc<Shared,*> so user can decrypt
    // All fields were encrypted together, so decrypt together
    const decryptedFields = enc.decrypt(
      [
        Array.from(order.pairId) as number[],
        Array.from(order.direction) as number[],
        Array.from(order.encryptedAmount) as number[],
      ],
      nonceBytes
    );

    return {
      batchId: order.batchId.toNumber(),
      pairId: Number(decryptedFields[0]),
      direction: Number(decryptedFields[1]),
      amount: decryptedFields[2],
    };
  }

  /** Cancel pending order — not yet implemented */
  async cancelOrder(): Promise<never> {
    throw new Error("Not implemented (Phase 11)");
  }

  // =========================================================================
  // BATCH EXECUTION
  // =========================================================================

  /** Execute the current batch when 8+ orders are accumulated. Anyone can call this. */
  async executeBatch(): Promise<string> {
    const batch = await this.getBatchInfo();
    
    if (batch.orderCount < 8) {
      throw new Error(`Not enough orders: ${batch.orderCount}/8. Need 8 orders to execute.`);
    }

    const batchId = batch.batchId;
    const [batchLogPDA] = getBatchLogPDA(this.programId, batchId);
    
    // Derive vault PDAs
    const [vaultUsdcPDA] = getVaultPDA(this.programId, "usdc");
    const [vaultTslaPDA] = getVaultPDA(this.programId, "tsla");
    const [vaultSpyPDA] = getVaultPDA(this.programId, "spy");
    const [vaultAaplPDA] = getVaultPDA(this.programId, "aapl");

    // Derive reserve PDAs
    const [reserveUsdcPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve"), Buffer.from("usdc")],
      this.programId
    );
    const [reserveTslaPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve"), Buffer.from("tsla")],
      this.programId
    );
    const [reserveSpyPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve"), Buffer.from("spy")],
      this.programId
    );
    const [reserveAaplPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve"), Buffer.from("aapl")],
      this.programId
    );

    const computationOffset = this._generateComputationOffset();
    const owner = this.wallet.publicKey;

    const sig = await this.program.methods
      .executeBatch(computationOffset)
      .accountsPartial({
        payer: owner,
        caller: owner,
        pool: this.poolPDA,
        batchAccumulator: this.batchAccumulatorPDA,
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
        ...this._getArciumAccounts("reveal_batch", computationOffset),
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    // Wait for MPC computation
    await this._awaitComputation(computationOffset);
    
    return sig;
  }

  // =========================================================================
  // SETTLEMENT METHODS
  // =========================================================================

  /** Settle a pending order after batch execution. Uses internal encryption if param omitted. */
  async settleOrder(
    pairId: number,
    direction: number,
    encryptionPublicKey?: Uint8Array
  ): Promise<string> {
    const pubkey = encryptionPublicKey || this._requireEncryption().pubkey;
    const owner = this.wallet.publicKey;
    const [userAccountPDA] = getUserAccountPDA(this.programId, owner);

    const account = await this.fetchUserAccount();
    if (!account.pendingOrder) throw new Error("No pending order to settle");

    const batchId = account.pendingOrder.batchId.toNumber();
    const [batchLogPDA] = getBatchLogPDA(this.programId, batchId);

    const settlementNonce = randomBytes(16);
    const computationOffset = this._generateComputationOffset();

    const sig = await this.program.methods
      .settleOrder(
        computationOffset,
        Array.from(pubkey),
        nonceToBN(settlementNonce),
        pairId,
        direction
      )
      .accountsPartial({
        payer: owner,
        user: owner,
        userAccount: userAccountPDA,
        batchLog: batchLogPDA,
        ...this._getArciumAccounts("calculate_payout", computationOffset),
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    await this._awaitComputation(computationOffset);
    return sig;
  }

  // =========================================================================
  // QUERY METHODS
  // =========================================================================

  /** Fetch current batch accumulator state */
  async getBatchInfo(): Promise<BatchInfo> {
    const batch = await (this.program.account as any).batchAccumulator.fetch(
      this.batchAccumulatorPDA
    );
    return {
      batchId: batch.batchId.toNumber(),
      orderCount: batch.orderCount,
      mxeNonce: batch.mxeNonce.toString(),
    };
  }

  /** Fetch historical batch log */
  async getBatchLog(batchId: number): Promise<BatchResult> {
    const [batchLogPDA] = getBatchLogPDA(this.programId, batchId);
    const log = await (this.program.account as any).batchLog.fetch(batchLogPDA);

    // Note: Anchor uses camelCase field names (converted from Rust's snake_case)
    const results: PairResult[] = log.results.map((r: any) => ({
      totalAIn: r.totalAIn ?? r.total_a_in,
      totalBIn: r.totalBIn ?? r.total_b_in,
      finalPoolA: r.finalPoolA ?? r.final_pool_a,
      finalPoolB: r.finalPoolB ?? r.final_pool_b,
    }));

    return {
      batchId: log.batchId?.toNumber() ?? log.batch_id?.toNumber(),
      results,
    };
  }

  /**
   * Fetch all historical batch logs.
   * Iterates from batch 1 to the current batch ID and returns all found logs.
   * @returns Array of BatchResult for all executed batches
   */
  async getAllBatchLogs(): Promise<BatchResult[]> {
    const batchInfo = await this.getBatchInfo();
    const currentBatchId = batchInfo.batchId;
    
    // Batch IDs start at 1 and increment. Current batchId is the next batch to be executed.
    // So executed batches are 1 to (currentBatchId - 1)
    const logs: BatchResult[] = [];
    
    for (let batchId = 1; batchId < currentBatchId; batchId++) {
      try {
        const log = await this.getBatchLog(batchId);
        logs.push(log);
      } catch (e) {
        // BatchLog doesn't exist - skip
        // This can happen if batch was never executed or PDA doesn't exist
        continue;
      }
    }
    
    return logs;
  }

  /**
   * Estimate payout for a pending order after batch execution.
   * Uses client-side calculation: payout = (orderAmount / totalInput) * finalPoolOutput
   * 
   * @param cipher - Optional cipher (uses internal if omitted)
   * @param owner - Optional owner pubkey (uses wallet if omitted)
   * @returns EstimatedPayout or null if no pending order or batch not executed
   */
  async estimatePayout(
    cipher?: RescueCipher,
    owner?: PublicKey
  ): Promise<EstimatedPayout | null> {
    // Get decrypted order info
    const order = await this.getDecryptedOrder(cipher, owner);
    if (!order) return null;

    // Try to fetch batch log (may not exist if batch not executed)
    let batchLog: BatchResult;
    try {
      batchLog = await this.getBatchLog(order.batchId);
    } catch (e) {
      // BatchLog doesn't exist yet - batch not executed
      return null;
    }

    const pairResult = batchLog.results[order.pairId];
    
    // Determine totals based on direction
    // direction 0 = A_to_B (sell A, get B)
    // direction 1 = B_to_A (sell B, get A)
    const totalInput = order.direction === 0 
      ? BigInt(pairResult.totalAIn.toString())
      : BigInt(pairResult.totalBIn.toString());
    
    const finalPoolOutput = order.direction === 0
      ? BigInt(pairResult.finalPoolB.toString())
      : BigInt(pairResult.finalPoolA.toString());

    // Prevent division by zero
    if (totalInput === 0n) {
      return null;
    }

    // Calculate pro-rata payout: (orderAmount * finalPoolOutput) / totalInput
    const orderAmount = order.amount;
    const estimatedPayout = (orderAmount * finalPoolOutput) / totalInput;

    // Determine output asset ID based on pair and direction
    // Simplified: for now, use rough mapping
    // TODO: Implement proper pair -> asset mapping
    const outputAssetId = this._getOutputAssetId(order.pairId, order.direction);

    return {
      batchId: order.batchId,
      pairId: order.pairId,
      direction: order.direction,
      orderAmount,
      totalInput,
      finalPoolOutput,
      estimatedPayout,
      outputAssetId,
    };
  }

  /**
   * Get effective balance for an asset, including pending payout.
   * Combines current on-chain balance with estimated payout from pending order.
   * 
   * @param assetId - Asset to check (0=USDC, 1=TSLA, 2=SPY, 3=AAPL)
   * @param cipher - Optional cipher (uses internal if omitted)
   * @param owner - Optional owner pubkey (uses wallet if omitted)
   * @returns EffectiveBalance with current, pending, and total
   */
  async getEffectiveBalance(
    assetId: AssetId,
    cipher?: RescueCipher,
    owner?: PublicKey
  ): Promise<EffectiveBalance> {
    const enc = cipher || this._requireEncryption().cipher;
    
    // Get current on-chain balances for all assets
    const balances = await this.getBalance(enc, owner);
    
    // Extract the specific asset balance
    const assetLabels: Record<AssetId, keyof typeof balances> = {
      [AssetId.USDC]: 'usdc',
      [AssetId.TSLA]: 'tsla',
      [AssetId.SPY]: 'spy',
      [AssetId.AAPL]: 'aapl',
    };
    const currentBalance = balances[assetLabels[assetId]];
    
    // Try to estimate pending payout
    const payout = await this.estimatePayout(enc, owner);
    
    let pendingPayout = 0n;
    let hasPendingOrder = false;
    
    if (payout && payout.outputAssetId === assetId) {
      pendingPayout = payout.estimatedPayout;
      hasPendingOrder = true;
    } else if (payout) {
      // Has pending order but for different asset
      hasPendingOrder = true;
    }

    return {
      currentBalance,
      pendingPayout,
      effectiveBalance: currentBalance + pendingPayout,
      hasPendingOrder,
    };
  }

  /**
   * Helper to determine output asset ID based on pair and direction
   */
  private _getOutputAssetId(pairId: number, direction: number): AssetId {
    // Pair mapping (from constants):
    // TSLA_USDC = 0, SPY_USDC = 1, AAPL_USDC = 2
    // TSLA_SPY = 3, TSLA_AAPL = 4, SPY_AAPL = 5
    //
    // Direction: 0 = A_to_B (sell A, get B), 1 = B_to_A (sell B, get A)
    
    const pairAssets: [AssetId, AssetId][] = [
      [AssetId.TSLA, AssetId.USDC],  // pair 0: TSLA/USDC
      [AssetId.SPY, AssetId.USDC],   // pair 1: SPY/USDC
      [AssetId.AAPL, AssetId.USDC],  // pair 2: AAPL/USDC
      [AssetId.TSLA, AssetId.SPY],   // pair 3: TSLA/SPY
      [AssetId.TSLA, AssetId.AAPL],  // pair 4: TSLA/AAPL
      [AssetId.SPY, AssetId.AAPL],   // pair 5: SPY/AAPL
    ];

    const [assetA, assetB] = pairAssets[pairId] || [AssetId.USDC, AssetId.USDC];
    
    // If selling A (direction 0), user gets B. If selling B (direction 1), user gets A.
    return direction === 0 ? assetB : assetA;
  }

  /** Fetch pool account data */
  async getPoolInfo(): Promise<any> {
    return (this.program.account as any).pool.fetch(this.poolPDA);
  }

  // =========================================================================
  // INTERNAL HELPERS
  // =========================================================================

  private _getArciumAccounts(
    compDefName: string,
    computationOffset: anchor.BN
  ): Record<string, PublicKey> {
    return {
      signPdaAccount: PublicKey.findProgramAddressSync(
        [Buffer.from("ArciumSignerAccount")],
        this.programId
      )[0],
      mxeAccount: getMXEAccAddress(this.programId),
      mempoolAccount: getMempoolAccAddress(this.clusterOffset),
      executingPool: getExecutingPoolAccAddress(this.clusterOffset),
      computationAccount: getComputationAccAddress(
        this.clusterOffset,
        computationOffset
      ),
      compDefAccount: getCompDefAccAddress(
        this.programId,
        Buffer.from(getCompDefAccOffset(compDefName)).readUInt32LE()
      ),
      clusterAccount: this.clusterAccount,
    };
  }

  private async _awaitComputation(
    offset: anchor.BN,
    timeoutMs: number = 60000,
    maxRetries: number = 3
  ): Promise<string> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await Promise.race([
          awaitComputationFinalization(
            this.provider,
            offset,
            this.programId,
            "confirmed"
          ),
          new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error(`MPC timeout (attempt ${attempt}/${maxRetries})`)),
              timeoutMs
            );
          }),
        ]);
        return result;
      } catch (error: any) {
        if (error.message.includes("timeout") && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        throw error;
      }
    }
    throw new Error("MPC computation failed after all retries");
  }

  private _generateComputationOffset(): anchor.BN {
    return new anchor.BN(randomBytes(8), "hex");
  }
}
