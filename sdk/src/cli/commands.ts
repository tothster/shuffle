/**
 * CLI Command Implementations
 * 
 * Each command function handles both real and mock mode operations.
 */

import chalk from "chalk";
import { PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import { getConfig, CLIConfig } from "./config";
import {
  withSpinner,
  createProgressSpinner,
  printHeader,
  printBalanceTable,
  printOrderStatus,
  printBatchStatus,
  printTxSuccess,
  printError,
  printInfo,
  printSuccess,
  printMockWarning,
  printBatchHistory,
} from "./output";
import {
  getMockState,
  updateMockState,
  mockDelay,
  mockSignature,
  DEVNET_CONFIG,
  LOCALNET_CONFIG,
} from "./devnet";
import { getFaucetVaultPDA } from "../pda";
import { AssetId, PairId, Direction, ASSET_LABELS } from "../constants";

function getErrorLogs(error: any): string[] {
  if (!error) return [];
  if (Array.isArray(error.logs)) return error.logs;
  if (Array.isArray(error.transactionLogs)) return error.transactionLogs;
  if (Array.isArray(error.data?.logs)) return error.data.logs;
  return [];
}

function formatUsdc(amount: bigint): string {
  const num = Number(amount) / 1_000_000;
  if (num === 0) return "0.00";
  if (num < 0.01) {
    return num.toLocaleString("en-US", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
  }
  if (num < 1) {
    return num.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  }
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ============================================================================
// ACCOUNT COMMANDS
// ============================================================================

/**
 * shuffle init - Create privacy account
 */
export async function initCommand(): Promise<void> {
  const config = getConfig();

  if (config.mockMode) {
    printMockWarning();
    
    const progress = createProgressSpinner([
      "Generating encryption keypair...",
      "Creating privacy account on-chain...",
      "Initializing encrypted balances...",
    ]);

    progress.start();
    await mockDelay("medium");
    progress.nextStep();
    await mockDelay("medium");
    progress.nextStep();
    await mockDelay("fast");
    
    updateMockState({ accountExists: true });
    progress.succeed("Privacy account created!");

    console.log();
    console.log(chalk.gray(`  Wallet: ${config.wallet.publicKey.toBase58().slice(0, 20)}...`));
    console.log(chalk.gray(`  Network: ${config.network}`));
    console.log();
    return;
  }

  // Real mode
  if (!config.shuffleClient) {
    printError("Not connected to Shuffle protocol");
    return;
  }

  try {
    const exists = await config.shuffleClient.accountExists();
    if (exists) {
      printInfo("Privacy account already exists!");
      return;
    }

    const sig = await withSpinner(
      "Creating privacy account...",
      () => config.shuffleClient!.createUserAccount(),
      "Privacy account created!"
    );

    printTxSuccess(sig, config.network);
  } catch (e: any) {
    printError(e.message);
  }
}

/**
 * shuffle balance - View encrypted balances
 */
export async function balanceCommand(): Promise<void> {
  const config = getConfig();

  if (config.mockMode) {
    printMockWarning();

    const state = getMockState();
    if (!state.accountExists) {
      printError("Account not found. Run 'shuffle init' first.");
      return;
    }

    await withSpinner(
      "Decrypting balances with MPC...",
      () => mockDelay("fast"),
      "Balances decrypted!"
    );

    // Mock unshielded balances (0 for demo)
    const unshielded = { usdc: 0n, tsla: 0n, spy: 0n, aapl: 0n };
    
    // Mock pending payout (if there's an executed order, show payout)
    // For demo: if pendingOrder exists and batch was "executed" (batchId > order.batchId)
    const pendingPayout = state.pendingOrder && state.batchId > state.pendingOrder.batchId
      ? { amount: state.pendingOrder.amount / 10n, assetId: state.pendingOrder.pairId === 0 ? 1 : 2 }
      : null;
    
    printBalanceTable(state.balances, unshielded, pendingPayout);
    return;
  }

  // Real mode
  if (!config.shuffleClient) {
    printError("Not connected to Shuffle protocol");
    return;
  }

  try {
    // Fetch shielded, unshielded, and estimated payout (for lazy settlement)
    const [shielded, unshielded, estimatedPayout, solBalance] = await withSpinner(
      "Fetching balances...",
      async () => {
        const [shieldedBalances, unshieldedBalances, payout, sol] = await Promise.all([
          config.shuffleClient!.getBalance(),
          config.shuffleClient!.getUnshieldedBalances(),
          config.shuffleClient!.estimatePayout(),
          config.connection.getBalance(config.wallet.publicKey),
        ]);
        return [shieldedBalances, unshieldedBalances, payout, sol];
      },
      "Balances loaded!"
    );

    // Pass pending payout to display it directly in the balance (cyan color)
    const pendingPayout = estimatedPayout 
      ? { amount: estimatedPayout.estimatedPayout, assetId: estimatedPayout.outputAssetId }
      : null;
    
    printBalanceTable(shielded, unshielded, pendingPayout, solBalance);
  } catch (e: any) {
    // If account doesn't exist, show only unshielded
    if (e.message?.includes("Account does not exist") || e.message?.includes("not found")) {
      try {
        const [unshielded, solBalance] = await Promise.all([
          config.shuffleClient!.getUnshieldedBalances(),
          config.connection.getBalance(config.wallet.publicKey),
        ]);
        console.log(chalk.yellow("\n  ⚠ No shielded account. Run 'shuffle init' to create one.\n"));
        printBalanceTable(
          { usdc: BigInt(0), tsla: BigInt(0), spy: BigInt(0), aapl: BigInt(0) },
          unshielded,
          null,
          solBalance
        );
      } catch {
        printError("Privacy account not found. Run 'shuffle init' first.");
      }
    } else {
      printError(e.message);
    }
  }
}

// ============================================================================
// TOKEN COMMANDS
// ============================================================================

/**
 * Parse asset name to AssetId
 */
function parseAsset(asset: string): AssetId {
  const upper = asset.toUpperCase();
  const mapping: Record<string, AssetId> = {
    USDC: AssetId.USDC,
    TSLA: AssetId.TSLA,
    SPY: AssetId.SPY,
    AAPL: AssetId.AAPL,
  };
  if (!(upper in mapping)) {
    throw new Error(`Invalid asset: ${asset}. Use: USDC, TSLA, SPY, AAPL`);
  }
  return mapping[upper];
}

/**
 * shuffle deposit <asset> <amount>
 */
export async function depositCommand(asset: string, amountStr: string): Promise<void> {
  const config = getConfig();
  const amount = parseFloat(amountStr);
  
  if (isNaN(amount) || amount <= 0) {
    printError("Invalid amount. Must be a positive number.");
    return;
  }

  let assetId: AssetId;
  try {
    assetId = parseAsset(asset);
  } catch (e: any) {
    printError(e.message);
    return;
  }

  const amountRaw = BigInt(Math.floor(amount * 1_000_000)); // 6 decimals

  if (config.mockMode) {
    printMockWarning();

    const state = getMockState();
    if (!state.accountExists) {
      printError("Account not found. Run 'shuffle init' first.");
      return;
    }

    const progress = createProgressSpinner([
      `Encrypting ${amount} ${asset}...`,
      "Transferring tokens to protocol vault...",
      "Updating encrypted balance via MPC...",
    ]);

    progress.start();
    await mockDelay("fast");
    progress.nextStep();
    await mockDelay("medium");
    progress.nextStep();
    await mockDelay("slow");

    // Update mock balance
    const key = asset.toLowerCase() as keyof typeof state.balances;
    state.balances[key] += amountRaw;
    updateMockState({ balances: state.balances });

    progress.succeed(`Shielded ${amount.toLocaleString()} ${asset}!`);
    printTxSuccess(mockSignature(), config.network);
    return;
  }

  // Real mode
  if (!config.shuffleClient) {
    printError("Not connected to Shuffle protocol");
    return;
  }

  try {
    const sig = await withSpinner(
      `Shielding ${amount} ${asset}...`,
      () => config.shuffleClient!.deposit(assetId, Math.floor(amount * 1_000_000)),
      `Shielded ${amount.toLocaleString()} ${asset}!`
    );

    printTxSuccess(sig, config.network);
  } catch (e: any) {
    // Provide user-friendly error messages
    const msg = e.message || "";
    if (msg.includes("Unknown action") || msg.includes("undefined")) {
      printError(`No ${asset} tokens in your wallet. Use 'shuffle faucet ${amount}' first!`);
    } else if (msg.includes("insufficient") || msg.includes("0x1")) {
      printError(`Insufficient ${asset} balance. Get tokens with 'shuffle faucet <amount>' first.`);
    } else if (msg.includes("Account does not exist")) {
      printError("Privacy account not found. Run 'shuffle init' first.");
    } else {
      printError(msg);
    }
  }
}

/**
 * shuffle withdraw <asset> <amount>
 */
export async function withdrawCommand(asset: string, amountStr: string): Promise<void> {
  const config = getConfig();
  const amount = parseFloat(amountStr);

  if (isNaN(amount) || amount <= 0) {
    printError("Invalid amount. Must be a positive number.");
    return;
  }

  let assetId: AssetId;
  try {
    assetId = parseAsset(asset);
  } catch (e: any) {
    printError(e.message);
    return;
  }

  const amountRaw = BigInt(Math.floor(amount * 1_000_000));

  if (config.mockMode) {
    printMockWarning();

    const state = getMockState();
    if (!state.accountExists) {
      printError("Account not found. Run 'shuffle init' first.");
      return;
    }

    const key = asset.toLowerCase() as keyof typeof state.balances;
    if (state.balances[key] < amountRaw) {
      printError(`Insufficient ${asset} balance.`);
      return;
    }

    const progress = createProgressSpinner([
      "Proving withdrawal via MPC...",
      "Decrypting balance check...",
      `Transferring ${amount} ${asset} to your wallet...`,
    ]);

    progress.start();
    await mockDelay("slow");
    progress.nextStep();
    await mockDelay("medium");
    progress.nextStep();
    await mockDelay("fast");

    state.balances[key] -= amountRaw;
    updateMockState({ balances: state.balances });

    progress.succeed(`Unshielded ${amount.toLocaleString()} ${asset}!`);
    printTxSuccess(mockSignature(), config.network);
    return;
  }

  // Real mode
  if (!config.shuffleClient) {
    printError("Not connected to Shuffle protocol");
    return;
  }

  try {
    // Check shielded balance before attempting withdraw
    const assetLabels: Record<AssetId, keyof { usdc: bigint; tsla: bigint; spy: bigint; aapl: bigint }> = {
      [AssetId.USDC]: 'usdc',
      [AssetId.TSLA]: 'tsla',
      [AssetId.SPY]: 'spy',
      [AssetId.AAPL]: 'aapl',
    };
    
    const [shielded, unshielded] = await Promise.all([
      config.shuffleClient.getBalance(),
      config.shuffleClient.getUnshieldedBalances(),
    ]);
    
    const assetKey = assetLabels[assetId];
    const shieldedBalance = shielded[assetKey];
    const unshieldedBalance = unshielded[assetKey];
    const shieldedFormatted = (Number(shieldedBalance) / 1_000_000).toFixed(2);
    const unshieldedFormatted = (Number(unshieldedBalance) / 1_000_000).toFixed(2);

    if (shieldedBalance < amountRaw) {
      console.log();
      printError(`Insufficient shielded ${asset.toUpperCase()} balance!`);
      console.log(chalk.gray(`\n  Your shielded balance: ${chalk.white(shieldedFormatted)} ${asset.toUpperCase()}`));
      console.log(chalk.gray(`  Requested amount:      ${chalk.white(amount.toFixed(2))} ${asset.toUpperCase()}\n`));
      
      if (shieldedBalance > 0n) {
        console.log(chalk.yellow(`  💡 You can unshield up to ${shieldedFormatted} ${asset.toUpperCase()}`));
        console.log(chalk.gray(`     Try: shuffle unshield ${asset.toLowerCase()} ${shieldedFormatted}\n`));
      }
      return;
    }

    const sig = await withSpinner(
      `Unshielding ${amount} ${asset}...`,
      () => config.shuffleClient!.withdraw(assetId, Math.floor(amount * 1_000_000)),
      `Unshielded ${amount.toLocaleString()} ${asset}!`
    );

    printTxSuccess(sig, config.network);
  } catch (e: any) {
    // Provide user-friendly error messages
    const msg = e.message || "";
    if (msg.includes("Unknown action") || msg.includes("undefined")) {
      printError(`Insufficient ${asset} balance! Check your balance with 'shuffle balance'.`);
    } else if (msg.includes("insufficient") || msg.includes("0x1")) {
      printError(`Insufficient ${asset} balance to withdraw ${amount}. Check your balance first.`);
    } else if (msg.includes("Account does not exist")) {
      printError("Privacy account not found. Run 'shuffle init' first.");
    } else if (msg.includes("custom program error")) {
      printError(`Cannot withdraw ${amount} ${asset}. Your balance may be too low.`);
    } else {
      printError(msg);
    }
  }
}

/**
 * shuffle transfer <address> <amount>
 */
export async function transferCommand(address: string, amountStr: string): Promise<void> {
  const config = getConfig();
  const amount = parseFloat(amountStr);

  if (isNaN(amount) || amount <= 0) {
    printError("Invalid amount. Must be a positive number.");
    return;
  }

  let recipientPubkey: PublicKey;
  try {
    recipientPubkey = new PublicKey(address);
  } catch {
    printError("Invalid Solana address.");
    return;
  }

  const amountRaw = BigInt(Math.floor(amount * 1_000_000));

  if (config.mockMode) {
    printMockWarning();

    const state = getMockState();
    if (!state.accountExists) {
      printError("Account not found. Run 'shuffle init' first.");
      return;
    }

    if (state.balances.usdc < amountRaw) {
      printError("Insufficient USDC balance.");
      return;
    }

    const progress = createProgressSpinner([
      "Encrypting transfer amount...",
      "Computing private transfer via MPC...",
      "Updating both accounts' balances...",
    ]);

    progress.start();
    await mockDelay("fast");
    progress.nextStep();
    await mockDelay("slow");
    progress.nextStep();
    await mockDelay("medium");

    state.balances.usdc -= amountRaw;
    updateMockState({ balances: state.balances });

    progress.succeed(`Transferred ${amount.toLocaleString()} USDC privately!`);
    console.log(chalk.gray(`  To: ${address.slice(0, 20)}...`));
    printTxSuccess(mockSignature(), config.network);
    return;
  }

  // Real mode
  if (!config.shuffleClient) {
    printError("Not connected to Shuffle protocol");
    return;
  }

  try {
    // Check shielded USDC balance before transfer
    const [shielded, unshielded] = await Promise.all([
      config.shuffleClient.getBalance(),
      config.shuffleClient.getUnshieldedBalances(),
    ]);
    
    const shieldedBalance = shielded.usdc;
    const unshieldedBalance = unshielded.usdc;
    const shieldedFormatted = (Number(shieldedBalance) / 1_000_000).toFixed(2);
    const unshieldedFormatted = (Number(unshieldedBalance) / 1_000_000).toFixed(2);

    if (shieldedBalance < amountRaw) {
      console.log();
      printError(`Insufficient shielded USDC balance!`);
      console.log(chalk.gray(`\n  Your shielded balance: ${chalk.white(shieldedFormatted)} USDC`));
      console.log(chalk.gray(`  Requested amount:      ${chalk.white(amount.toFixed(2))} USDC\n`));
      
      if (unshieldedBalance > 0n) {
        console.log(chalk.yellow(`  💡 You have ${unshieldedFormatted} USDC unshielded in your wallet.`));
        console.log(chalk.gray(`     Shield it first with: shuffle shield usdc ${unshieldedFormatted}\n`));
      }
      return;
    }

    const sig = await withSpinner(
      `Transferring ${amount} USDC privately...`,
      () => config.shuffleClient!.transfer(recipientPubkey, Math.floor(amount * 1_000_000)),
      `Transferred ${amount.toLocaleString()} USDC!`
    );

    printTxSuccess(sig, config.network);
  } catch (e: any) {
    // Provide user-friendly error messages
    const msg = e.message || "";
    if (msg.includes("Unknown action") || msg.includes("undefined")) {
      printError(`Insufficient USDC balance for transfer! Check your balance with 'shuffle balance'.`);
    } else if (msg.includes("insufficient") || msg.includes("0x1")) {
      printError(`Insufficient USDC balance to transfer ${amount}. Check your balance first.`);
    } else if (msg.includes("Account does not exist") || msg.includes("not found")) {
      printError("Recipient doesn't have a Shuffle account. They need to run 'shuffle init' first.");
    } else if (msg.includes("invalid public key")) {
      printError("Invalid recipient address. Please check and try again.");
    } else {
      printError(msg);
    }
  }
}

// ============================================================================
// TRADING COMMANDS
// ============================================================================

/**
 * Parse pair name to PairId
 */
function parsePair(pair: string): PairId {
  const upper = pair.toUpperCase().replace("/", "_");
  const mapping: Record<string, PairId> = {
    TSLA_USDC: PairId.TSLA_USDC,
    SPY_USDC: PairId.SPY_USDC,
    AAPL_USDC: PairId.AAPL_USDC,
    TSLA_SPY: PairId.TSLA_SPY,
    TSLA_AAPL: PairId.TSLA_AAPL,
    SPY_AAPL: PairId.SPY_AAPL,
  };
  if (!(upper in mapping)) {
    throw new Error(`Invalid pair: ${pair}. Use: TSLA_USDC, SPY_USDC, AAPL_USDC, TSLA_SPY, TSLA_AAPL, SPY_AAPL`);
  }
  return mapping[upper];
}

/**
 * Parse direction string to Direction enum
 */
function parseDirection(dir: string): Direction {
  const lower = dir.toLowerCase();
  // "buy" means buying the BASE token (e.g., TSLA in TSLA/USDC)
  // That means selling the QUOTE token (USDC) → BtoA direction
  if (lower === "buy" || lower === "b_to_a" || lower === "1") {
    return Direction.BtoA;
  }
  // "sell" means selling the BASE token (e.g., TSLA in TSLA/USDC)
  // That means buying the QUOTE token (USDC) → AtoB direction
  if (lower === "sell" || lower === "a_to_b" || lower === "0") {
    return Direction.AtoB;
  }
  throw new Error(`Invalid direction: ${dir}. Use: buy, sell`);
}

/**
 * Infer source asset from pair and direction
 */
function inferSourceAsset(pairId: PairId, direction: Direction): AssetId {
  // Pair definitions: [baseAsset, quoteAsset]
  const pairAssets: Record<PairId, [AssetId, AssetId]> = {
    [PairId.TSLA_USDC]: [AssetId.TSLA, AssetId.USDC],
    [PairId.SPY_USDC]: [AssetId.SPY, AssetId.USDC],
    [PairId.AAPL_USDC]: [AssetId.AAPL, AssetId.USDC],
    [PairId.TSLA_SPY]: [AssetId.TSLA, AssetId.SPY],
    [PairId.TSLA_AAPL]: [AssetId.TSLA, AssetId.AAPL],
    [PairId.SPY_AAPL]: [AssetId.SPY, AssetId.AAPL],
  };
  
  const [base, quote] = pairAssets[pairId];
  // AtoB = selling A (base) for B (quote), so source is base
  // BtoA = selling B (quote) for A (base), so source is quote
  return direction === Direction.AtoB ? base : quote;
}

/**
 * shuffle order [pair] [direction] [amount]
 * Interactive mode if no args provided
 */
export async function orderCommand(pair?: string, direction?: string, amountStr?: string): Promise<void> {
  const config = getConfig();

  // If all args provided, use direct mode
  if (pair && direction && amountStr) {
    return executeDirectOrder(config, pair, direction, amountStr);
  }

  // Interactive mode
  return executeInteractiveOrder(config);
}

/**
 * Execute order with direct CLI arguments (original behavior)
 */
async function executeDirectOrder(
  config: CLIConfig,
  pair: string,
  direction: string,
  amountStr: string
): Promise<void> {
  const amount = parseFloat(amountStr);

  if (isNaN(amount) || amount <= 0) {
    printError("Invalid amount. Must be a positive number.");
    return;
  }

  let pairId: PairId;
  let dir: Direction;
  try {
    pairId = parsePair(pair);
    dir = parseDirection(direction);
  } catch (e: any) {
    printError(e.message);
    return;
  }

  const amountRaw = BigInt(Math.floor(amount * 1_000_000));
  const sourceAsset = inferSourceAsset(pairId, dir);

  if (config.mockMode) {
    printMockWarning();

    const state = getMockState();
    if (!state.accountExists) {
      printError("Account not found. Run 'shuffle init' first.");
      return;
    }

    if (state.pendingOrder) {
      printError("You have a pending order. Settle it first with 'shuffle settle'.");
      return;
    }

    const progress = createProgressSpinner([
      "Encrypting order details...",
      "Submitting to batch aggregator...",
      "Accumulating in MPC cluster...",
      "Order encrypted and queued!",
    ]);

    progress.start();
    await mockDelay("fast");
    progress.nextStep();
    await mockDelay("medium");
    progress.nextStep();
    await mockDelay("slow");
    progress.nextStep();
    await mockDelay("fast");

    updateMockState({
      pendingOrder: {
        batchId: state.batchId,
        pairId,
        direction: dir,
        amount: amountRaw,
      },
    });

    progress.succeed("Order placed!");
    console.log();
    console.log(chalk.gray(`  Pair:      ${pair.toUpperCase()}`));
    console.log(chalk.gray(`  Direction: ${direction === "buy" ? "BUY" : "SELL"}`));
    console.log(chalk.gray(`  Amount:    ${amount.toLocaleString()}`));
    console.log(chalk.gray(`  Batch:     #${state.batchId}`));
    console.log();
    printSuccess("Your order is encrypted and hidden until batch execution!");
    printTxSuccess(mockSignature(), config.network);
    return;
  }

  // Real mode
  if (!config.shuffleClient) {
    printError("Not connected to Shuffle protocol");
    return;
  }

  try {
    // Check if user already has a pending order
    const existingOrder = await config.shuffleClient.getDecryptedOrder();
    if (existingOrder) {
      const pairLabels = ["TSLA/USDC", "SPY/USDC", "AAPL/USDC"];
      const dirLabel = existingOrder.direction === 0 ? "BUY" : "SELL";
      const orderAmount = (Number(existingOrder.amount) / 1_000_000).toFixed(2);
      
      console.log();
      printError("You already have a pending order!");
      console.log(chalk.gray(`\n  Pending order: ${chalk.white(dirLabel)} ${pairLabels[existingOrder.pairId] || "Unknown"}`));
      console.log(chalk.gray(`  Amount:        ${chalk.white(orderAmount)} USDC`));
      console.log(chalk.gray(`  Batch ID:      ${chalk.white(existingOrder.batchId)}\n`));
      console.log(chalk.yellow(`  💡 Wait for batch execution, then settle with: shuffle settle`));
      console.log(chalk.gray(`     Check status with: shuffle status\n`));
      return;
    }

    // Check shielded USDC balance before placing order
    // Orders use USDC as the source asset (buying TSLA/SPY with USDC)
    const [shielded, unshielded] = await Promise.all([
      config.shuffleClient.getBalance(),
      config.shuffleClient.getUnshieldedBalances(),
    ]);
    
    const amountRaw = BigInt(Math.floor(amount * 1_000_000));
    const shieldedBalance = shielded.usdc;
    const unshieldedBalance = unshielded.usdc;
    const shieldedFormatted = (Number(shieldedBalance) / 1_000_000).toFixed(2);
    const unshieldedFormatted = (Number(unshieldedBalance) / 1_000_000).toFixed(2);

    if (shieldedBalance < amountRaw) {
      console.log();
      printError(`Insufficient shielded USDC balance for this order!`);
      console.log(chalk.gray(`\n  Your shielded balance: ${chalk.white(shieldedFormatted)} USDC`));
      console.log(chalk.gray(`  Order amount:          ${chalk.white(amount.toFixed(2))} USDC\n`));
      
      if (unshieldedBalance > 0n) {
        console.log(chalk.yellow(`  💡 You have ${unshieldedFormatted} USDC unshielded in your wallet.`));
        console.log(chalk.gray(`     Shield it first with: shuffle shield usdc ${unshieldedFormatted}\n`));
      } else {
        console.log(chalk.yellow(`  💡 Get USDC with: shuffle faucet ${amount}`));
        console.log(chalk.gray(`     Then shield it: shuffle shield usdc ${amount}\n`));
      }
      return;
    }

    const sig = await withSpinner(
      "Placing encrypted order...",
      () => config.shuffleClient!.placeOrder(
        pairId,
        dir,
        Math.floor(amount * 1_000_000),
        sourceAsset
      ),
      "Order placed!"
    );

    printTxSuccess(sig, config.network);
  } catch (e: any) {
    // Provide user-friendly error messages
    const msg = e.message || "";
    if (msg.includes("Unknown action") || msg.includes("undefined")) {
      printError("You already have a pending order! Wait for batch execution or settle first with 'shuffle settle'.");
    } else if (msg.includes("already in use") || msg.includes("0x0")) {
      printError("You already have a pending order in this batch. Wait for it to be settled.");
    } else if (msg.includes("insufficient") || msg.includes("balance")) {
      printError("Insufficient balance for this order. Check your balance with 'shuffle balance'.");
    } else if (msg.includes("Account does not exist")) {
      printError("Privacy account not found. Run 'shuffle init' first.");
    } else {
      printError(msg);
    }
  }
}

/**
 * Interactive order flow - asks user for each parameter
 */
async function executeInteractiveOrder(config: CLIConfig): Promise<void> {
  // @ts-ignore - inquirer types available after npm install
  const inquirer = (await import("inquirer")).default;
  
  printHeader("New Order");
  console.log(chalk.gray("  Let's set up your private order!\n"));

  // Check connection
  if (!config.mockMode && !config.shuffleClient) {
    printError("Not connected to Shuffle protocol");
    return;
  }

  // Check for existing pending order BEFORE interactive prompts
  if (!config.mockMode && config.shuffleClient) {
    try {
      const existingOrder = await config.shuffleClient.getDecryptedOrder();
      if (existingOrder) {
        const pairLabels = ["TSLA/USDC", "SPY/USDC", "AAPL/USDC"];
        const dirLabel = existingOrder.direction === 0 ? "BUY" : "SELL";
        const orderAmount = (Number(existingOrder.amount) / 1_000_000).toFixed(2);
        
        printError("You already have a pending order!");
        console.log(chalk.gray(`\n  Pending order: ${chalk.white(dirLabel)} ${pairLabels[existingOrder.pairId] || "Unknown"}`));
        console.log(chalk.gray(`  Amount:        ${chalk.white(orderAmount)} USDC`));
        console.log(chalk.gray(`  Batch ID:      ${chalk.white(existingOrder.batchId)}\n`));
        console.log(chalk.yellow(`  💡 Wait for batch execution, then settle with: shuffle settle`));
        console.log(chalk.gray(`     Check status with: shuffle status\n`));
        return;
      }
    } catch (e) {
      // Continue if check fails - will be caught later
    }
  }

  // Available tokens (the ones user can BUY)
  const allTokens = [
    { name: "TSLA - Tesla Stock Token", value: "TSLA" },
    { name: "SPY - S&P 500 ETF Token", value: "SPY" },
    { name: "AAPL - Apple Stock Token", value: "AAPL" },
    { name: "USDC - US Dollar Coin", value: "USDC" },
  ];

  // Step 1: What do you want to BUY?
  const { buyToken } = await inquirer.prompt([{
    type: "list",
    name: "buyToken",
    message: chalk.cyan("🎯 What token do you want to BUY?"),
    choices: allTokens,
    pageSize: 5,
  }]);

  // Step 2: Get user's balances to show what they CAN pay with
  let balances: { usdc: bigint; tsla: bigint; spy: bigint; aapl: bigint } | null = null;
  
  if (config.mockMode) {
    const state = getMockState();
    balances = state.balances;
  } else {
    try {
      balances = await withSpinner(
        "Checking your balances...",
        () => config.shuffleClient!.getBalance(),
        "Balances loaded!"
      );
    } catch (e: any) {
      printError("Could not fetch balances. Run 'shuffle init' first.");
      return;
    }
  }

  // Filter: only show tokens user has balance in AND are different from buy token
  const paymentOptions: Array<{name: string; value: string; balance: number}> = [];
  const tokenBalances: Record<string, bigint> = {
    USDC: balances.usdc,
    TSLA: balances.tsla,
    SPY: balances.spy,
    AAPL: balances.aapl,
  };

  for (const [token, balance] of Object.entries(tokenBalances)) {
    if (token !== buyToken && balance > 0n) {
      const displayBal = (Number(balance) / 1_000_000).toLocaleString("en-US", { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 6 
      });
      paymentOptions.push({
        name: `${token} (${displayBal} available)`,
        value: token,
        balance: Number(balance),
      });
    }
  }

  if (paymentOptions.length === 0) {
    printError(`You don't have any tokens to pay with! Use 'shuffle faucet 100' to get USDC.`);
    return;
  }

  // Step 3: What do you want to PAY with?
  const { payToken } = await inquirer.prompt([{
    type: "list",
    name: "payToken",
    message: chalk.cyan(`💰 What token do you want to PAY with for ${buyToken}?`),
    choices: paymentOptions.map(p => ({ name: p.name, value: p.value })),
    pageSize: 5,
  }]);

  const maxBalance = Number(tokenBalances[payToken]) / 1_000_000;

  // Step 4: How much?
  const { amount } = await inquirer.prompt([{
    type: "input",
    name: "amount",
    message: chalk.cyan(`📊 How much ${payToken} do you want to spend? (max: ${maxBalance.toLocaleString()})`),
    validate: (input: string) => {
      const num = parseFloat(input);
      if (isNaN(num) || num <= 0) return "Please enter a positive number";
      if (num > maxBalance) return `Maximum available: ${maxBalance.toLocaleString()}`;
      return true;
    },
  }]);

  // Step 5: Confirmation
  console.log();
  console.log(chalk.bold.white("  📋 Order Summary:"));
  console.log(chalk.gray(`     ├─ Buy:  ${chalk.green(buyToken)}`));
  console.log(chalk.gray(`     ├─ Pay:  ${chalk.yellow(amount)} ${payToken}`));
  console.log(chalk.gray(`     └─ Type: Private batch order`));
  console.log();

  const { confirm } = await inquirer.prompt([{
    type: "confirm",
    name: "confirm",
    message: chalk.cyan("Confirm and place order?"),
    default: true,
  }]);

  if (!confirm) {
    printInfo("Order cancelled.");
    return;
  }

  // Convert to pair and direction
  const pairInfo = convertToPairAndDirection(buyToken, payToken);
  if (!pairInfo) {
    printError(`Trading pair ${buyToken}/${payToken} not supported.`);
    return;
  }

  // Execute the order
  await executeDirectOrder(config, pairInfo.pair, pairInfo.direction, amount);
}

/**
 * Convert buy/pay tokens to pair and direction
 */
function convertToPairAndDirection(buyToken: string, payToken: string): { pair: string; direction: string } | null {
  // Define valid pairs: [base, quote] where base is first token in pair name
  const pairs: Array<{pair: string; base: string; quote: string}> = [
    { pair: "TSLA_USDC", base: "TSLA", quote: "USDC" },
    { pair: "SPY_USDC", base: "SPY", quote: "USDC" },
    { pair: "AAPL_USDC", base: "AAPL", quote: "USDC" },
    { pair: "TSLA_SPY", base: "TSLA", quote: "SPY" },
    { pair: "TSLA_AAPL", base: "TSLA", quote: "AAPL" },
    { pair: "SPY_AAPL", base: "SPY", quote: "AAPL" },
  ];

  for (const p of pairs) {
    // Buying base, paying quote = BtoA (quote → base)
    if (buyToken === p.base && payToken === p.quote) {
      return { pair: p.pair, direction: "buy" };
    }
    // Buying quote, paying base = AtoB (base → quote)
    if (buyToken === p.quote && payToken === p.base) {
      return { pair: p.pair, direction: "sell" };
    }
  }

  return null;
}

/**
 * shuffle settle - Settle pending order
 */
export async function settleCommand(): Promise<void> {
  const config = getConfig();

  if (config.mockMode) {
    printMockWarning();

    const state = getMockState();
    if (!state.accountExists) {
      printError("Account not found. Run 'shuffle init' first.");
      return;
    }

    if (!state.pendingOrder) {
      printError("No pending order to settle.");
      return;
    }

    const progress = createProgressSpinner([
      "Fetching batch execution results...",
      "Calculating your pro-rata payout via MPC...",
      "Updating encrypted balance...",
    ]);

    progress.start();
    await mockDelay("fast");
    progress.nextStep();
    await mockDelay("slow");
    progress.nextStep();
    await mockDelay("medium");

    // Simulate payout (slightly different amount due to "slippage")
    const payoutAmount = (state.pendingOrder.amount * 99n) / 100n;
    const assetLabels = ["USDC", "TSLA", "SPY", "AAPL"];
    const outputAsset = state.pendingOrder.direction === 0 ? 0 : 1; // simplified

    state.balances.usdc += payoutAmount; // Simplified: always pay in USDC
    updateMockState({
      balances: state.balances,
      pendingOrder: null,
      batchId: state.batchId + 1,
    });

    const payoutDisplay = (Number(payoutAmount) / 1_000_000).toLocaleString();
    progress.succeed(`Settled! Received ${payoutDisplay} USDC`);
    printTxSuccess(mockSignature(), config.network);
    return;
  }

  // Real mode
  if (!config.shuffleClient) {
    printError("Not connected to Shuffle protocol");
    return;
  }

  try {
    const order = await config.shuffleClient.getDecryptedOrder();
    if (!order) {
      printError("No pending order to settle.");
      return;
    }

    const sig = await withSpinner(
      "Settling order...",
      () => config.shuffleClient!.settleOrder(order.pairId, order.direction),
      "Order settled!"
    );

    printTxSuccess(sig, config.network);
  } catch (e: any) {
    // Provide user-friendly error messages
    const msg = e.message || "";
    if (msg.includes("Unknown action") || msg.includes("undefined")) {
      printError("No pending order to settle. Place an order first with 'shuffle order'.");
    } else if (msg.includes("not found") || msg.includes("Account does not exist")) {
      printError("Privacy account not found. Run 'shuffle init' first.");
    } else if (msg.includes("batch") || msg.includes("executed")) {
      printError("Batch not yet executed. Wait for batch execution before settling.");
    } else {
      printError(msg);
    }
  }
}

/**
 * shuffle execute - Trigger batch execution
 */
export async function executeCommand(): Promise<void> {
  const config = getConfig();

  if (config.mockMode) {
    printMockWarning();

    const state = getMockState();
    
    const progress = createProgressSpinner([
      "Checking batch status...",
      "Triggering batch execution...",
      "Waiting for MPC computation...",
      "Batch executed!",
    ]);

    progress.start();
    await mockDelay("fast");
    progress.nextStep();
    await mockDelay("medium");
    progress.nextStep();
    await mockDelay("slow");
    progress.nextStep();

    updateMockState({ batchId: state.batchId + 1 });
    progress.succeed("Batch executed successfully!");
    printTxSuccess(mockSignature(), config.network);
    return;
  }

  // Real mode
  if (!config.shuffleClient) {
    printError("Not connected to Shuffle protocol");
    return;
  }

  try {
    // First check batch status
    const batch = await config.shuffleClient.getBatchInfo();
    console.log(chalk.gray(`\n  Current batch: #${batch.batchId}`));
    console.log(chalk.gray(`  Orders: ${batch.orderCount}/8\n`));

    if (batch.orderCount < 8) {
      printError(`Not enough orders: ${batch.orderCount}/8. Need 8 orders to execute.`);
      return;
    }

    const sig = await withSpinner(
      "Executing batch (this may take ~60 seconds)...",
      () => config.shuffleClient!.executeBatch(),
      "Batch executed!"
    );

    printSuccess(`Batch #${batch.batchId} executed successfully!`);
    printTxSuccess(sig, config.network);
    console.log(chalk.cyan("\n  Users can now settle their orders with 'shuffle settle'\n"));
  } catch (e: any) {
    const msg = e.message || "";
    if (msg.includes("Not enough orders")) {
      printError(msg);
    } else if (msg.includes("already executed")) {
      printError("Batch already executed. Orders have been reset for the next batch.");
    } else {
      printError(msg);
    }
  }
}

/**
 * shuffle status - View batch and order status
 */
export async function statusCommand(): Promise<void> {
  const config = getConfig();

  if (config.mockMode) {
    printMockWarning();

    const state = getMockState();
    if (!state.accountExists) {
      printError("Account not found. Run 'shuffle init' first.");
      return;
    }

    await withSpinner(
      "Fetching status...",
      () => mockDelay("fast"),
      "Status retrieved!"
    );

    printHeader("Batch Status");
    printBatchStatus({
      batchId: state.batchId,
      orderCount: state.pendingOrder ? 1 : 0,
    });

    console.log();
    printHeader("Your Order Status");
    
    if (!state.pendingOrder) {
      console.log(chalk.gray("  No pending order\n"));
    } else {
      const pairLabels = ["TSLA/USDC", "SPY/USDC", "AAPL/USDC"];
      const dirLabel = state.pendingOrder.direction === 0 ? "BUY" : "SELL";
      const orderAmount = (Number(state.pendingOrder.amount) / 1_000_000).toFixed(2);
      const isExecuted = state.batchId > state.pendingOrder.batchId;
      
      console.log(chalk.gray(`  Pair:      ${chalk.white(pairLabels[state.pendingOrder.pairId] || "Unknown")}`));
      console.log(chalk.gray(`  Direction: ${chalk.white(dirLabel)}`));
      console.log(chalk.gray(`  Amount:    ${chalk.white(orderAmount)} USDC`));
      console.log(chalk.gray(`  Batch ID:  ${chalk.white(state.pendingOrder.batchId)}`));
      
      if (isExecuted) {
        const payoutAmount = (Number(state.pendingOrder.amount) / 10_000_000).toFixed(2);
        const outputAsset = state.pendingOrder.pairId === 0 ? "TSLA" : "SPY";
        console.log();
        console.log(chalk.green(`  ✓ Executed`));
        console.log(chalk.gray(`  Payout: ${chalk.cyan(payoutAmount)} ${outputAsset}`));
      } else {
        console.log();
        console.log(chalk.yellow(`  ⏳ Pending`));
      }
    }
    console.log();
    return;
  }

  // Real mode
  if (!config.shuffleClient) {
    printError("Not connected to Shuffle protocol");
    return;
  }

  try {
    const [batchInfo, order, estimatedPayout] = await Promise.all([
      config.shuffleClient.getBatchInfo(),
      config.shuffleClient.getDecryptedOrder(),
      config.shuffleClient.estimatePayout(),
    ]);

    printHeader("Batch Status");
    printBatchStatus(batchInfo);

    console.log();
    printHeader("Your Order Status");
    
    if (!order) {
      console.log(chalk.gray("  No pending order\n"));
    } else {
      const pairLabels = ["TSLA/USDC", "SPY/USDC", "AAPL/USDC"];
      const dirLabel = order.direction === 0 ? "BUY" : "SELL";
      const orderAmount = (Number(order.amount) / 1_000_000).toFixed(2);
      
      // Check if batch was executed by seeing if estimatePayout returned a value
      const isExecuted = estimatedPayout !== null;
      
      console.log(chalk.gray(`  Pair:      ${chalk.white(pairLabels[order.pairId] || "Unknown")}`));
      console.log(chalk.gray(`  Direction: ${chalk.white(dirLabel)}`));
      console.log(chalk.gray(`  Amount:    ${chalk.white(orderAmount)} USDC`));
      console.log(chalk.gray(`  Batch ID:  ${chalk.white(order.batchId)}`));
      
      if (isExecuted) {
        const payoutAmount = (Number(estimatedPayout.estimatedPayout) / 1_000_000).toFixed(2);
        const outputAsset = ["USDC", "TSLA", "SPY", "AAPL"][estimatedPayout.outputAssetId] || "tokens";
        
        console.log();
        console.log(chalk.green(`  ✓ Executed`));
        console.log(chalk.gray(`  Payout: ${chalk.cyan(payoutAmount)} ${outputAsset}`));
      } else {
        console.log();
        console.log(chalk.yellow(`  ⏳ Pending`));
      }
    }
    console.log();
  } catch (e: any) {
    // Provide user-friendly error messages
    const msg = e.message || "";
    if (msg.includes("Account does not exist") || msg.includes("not found")) {
      printError("Privacy account not found. Run 'shuffle init' first.");
    } else {
      printError(msg);
    }
  }
}

// ============================================================================
// DEVNET COMMANDS
// ============================================================================
/**
 * shuffle faucet <amount> - Claim USDC from program faucet
 */
export async function faucetCommand(amountStr: string): Promise<void> {
  const config = getConfig();
  const amount = parseFloat(amountStr);

  if (isNaN(amount) || amount <= 0) {
    printError("Invalid amount. Must be a positive number.");
    return;
  }

  const amountRaw = BigInt(Math.floor(amount * 1_000_000));

  if (config.mockMode) {
    printMockWarning();

    const state = getMockState();

    const progress = createProgressSpinner([
      "Connecting to USDC faucet...",
      `Claiming ${amount.toLocaleString()} USDC to your wallet...`,
      "Tokens received!",
    ]);

    progress.start();
    await mockDelay("fast");
    progress.nextStep();
    await mockDelay("medium");
    progress.nextStep();
    await mockDelay("fast");

    // In mock mode, also update account balance if it exists
    if (state.accountExists) {
      state.balances.usdc += amountRaw;
      updateMockState({ balances: state.balances });
    }

    progress.succeed(`Received ${amount.toLocaleString()} USDC!`);
    console.log(chalk.gray(`  Token: ${DEVNET_CONFIG.mints.USDC.toBase58().slice(0, 20)}...`));
    printTxSuccess(mockSignature(), config.network);
    return;
  }

  // Real mode - claim USDC via program faucet
  if (!config.shuffleClient) {
    printError("Not connected to Shuffle protocol");
    return;
  }

  try {
    // Preflight check: ensure faucet vault has enough USDC
    try {
      const programId = config.network === "localnet"
        ? LOCALNET_CONFIG.programId
        : DEVNET_CONFIG.programId;
      const [faucetVaultPDA] = getFaucetVaultPDA(programId);
      const faucetVault = await getAccount(config.connection, faucetVaultPDA);
      if (faucetVault.amount < amountRaw) {
        printError(
          `Faucet vault has insufficient USDC (available: ${formatUsdc(faucetVault.amount)}). ` +
          "Ask an admin to refill the faucet."
        );
        return;
      }
    } catch (e: any) {
      // If the faucet vault isn't initialized or can't be fetched, surface a clear message
      const msg = e?.message?.toLowerCase?.() || "";
      if (msg.includes("failed to find account") || msg.includes("could not find account") || msg.includes("not found")) {
        printError("Faucet vault is not initialized. Ask an admin to initialize and fund the faucet.");
        return;
      }
      // Fall through to attempt faucet call; it may still succeed
    }

    const sig = await withSpinner(
      `Claiming ${amount.toLocaleString()} USDC to your wallet...`,
      async () => {
        if (typeof (config.shuffleClient as any).faucet !== "function") {
          throw new Error("Faucet not supported by this SDK version.");
        }
        return await (config.shuffleClient as any).faucet(Math.floor(amount * 1_000_000));
      },
      `Received ${amount.toLocaleString()} USDC!`
    );

    printTxSuccess(sig, config.network);
  } catch (e: any) {
    // Improve error messages
    const msg = e.message || "";
    const logs = getErrorLogs(e);
    const hasTokenInsufficient = logs.some((log) => log.toLowerCase().includes("error: insufficient funds"));

    if (msg.includes("Account does not exist") || msg.includes("not found")) {
      printError("Privacy account not found. Run 'shuffle init' first.");
    } else if (msg.includes("Faucet limit exceeded") || msg.includes("FaucetLimitExceeded")) {
      printError("Faucet limit exceeded. You can claim up to 1000 USDC total.");
    } else if (hasTokenInsufficient) {
      printError("Faucet vault has insufficient USDC. Try a smaller amount or ask an admin to refill the faucet.");
    } else if (msg.toLowerCase().includes("insufficient funds") && (msg.toLowerCase().includes("fee") || msg.toLowerCase().includes("transaction"))) {
      printError("Insufficient SOL for transaction fees. Request an airdrop first with 'shuffle airdrop'.");
    } else {
      printError(msg || "Faucet failed");
    }
  }
}

/**
 * shuffle airdrop [amount] - Airdrop SOL on localnet
 */
export async function airdropCommand(amountStr?: string): Promise<void> {
  const config = getConfig();
  const amount = amountStr ? parseFloat(amountStr) : 2; // Default 2 SOL

  if (isNaN(amount) || amount <= 0) {
    printError("Invalid amount. Must be a positive number.");
    return;
  }

  if (config.mockMode) {
    printMockWarning();
    await mockDelay("fast");
    printSuccess(`Airdropped ${amount} SOL (mock)`);
    return;
  }

  // Real mode
  if (!config.connection) {
    printError("Not connected");
    return;
  }

  try {
    const pubkey = config.wallet.publicKey;
    console.log(chalk.gray(`\n  Wallet: ${pubkey.toBase58()}`));
    
    const sig = await withSpinner(
      `Requesting ${amount} SOL airdrop...`,
      async () => {
        const signature = await config.connection.requestAirdrop(
          pubkey,
          amount * 1_000_000_000 // Convert SOL to lamports
        );
        
        // Wait for confirmation
        await config.connection.confirmTransaction(signature, "confirmed");
        return signature;
      },
      `Received ${amount} SOL!`
    );

    const balance = await config.connection.getBalance(pubkey);
    console.log(chalk.gray(`  Balance: ${(balance / 1_000_000_000).toFixed(4)} SOL\n`));
    printTxSuccess(sig, config.network);
  } catch (e: any) {
    if (e.message?.includes("airdrop request")) {
      printError("Airdrop limit reached. Try again later or use a different network.");
    } else {
      printError(e.message || "Airdrop failed");
    }
  }
}

/**
 * shuffle history - Show all executed batch logs
 */
export async function historyCommand(): Promise<void> {
  const config = getConfig();

  if (config.mockMode) {
    printMockWarning();
    await mockDelay("fast");
    // Mock data for demo
    const mockLogs = [
      {
        batchId: 1,
        results: [
          { totalAIn: { toString: () => "1000000" }, totalBIn: { toString: () => "250000" }, finalPoolA: { toString: () => "750000" }, finalPoolB: { toString: () => "250000" } },
          { totalAIn: { toString: () => "0" }, totalBIn: { toString: () => "0" }, finalPoolA: { toString: () => "0" }, finalPoolB: { toString: () => "0" } },
          { totalAIn: { toString: () => "0" }, totalBIn: { toString: () => "0" }, finalPoolA: { toString: () => "0" }, finalPoolB: { toString: () => "0" } },
          { totalAIn: { toString: () => "0" }, totalBIn: { toString: () => "0" }, finalPoolA: { toString: () => "0" }, finalPoolB: { toString: () => "0" } },
          { totalAIn: { toString: () => "0" }, totalBIn: { toString: () => "0" }, finalPoolA: { toString: () => "0" }, finalPoolB: { toString: () => "0" } },
          { totalAIn: { toString: () => "0" }, totalBIn: { toString: () => "0" }, finalPoolA: { toString: () => "0" }, finalPoolB: { toString: () => "0" } },
        ],
      },
    ];
    printBatchHistory(mockLogs);
    return;
  }

  // Real mode
  if (!config.shuffleClient) {
    printError("Not connected. Run 'shuffle balance' first to initialize.");
    return;
  }

  try {
    const logs = await withSpinner(
      "Fetching batch history...",
      () => config.shuffleClient!.getAllBatchLogs(),
      "History loaded!"
    );

    printBatchHistory(logs);
  } catch (e: any) {
    printError(e.message || "Failed to fetch batch history");
  }
}
