/**
 * Terminal Output Utilities
 * 
 * Provides spinners, colorized output, and formatted displays
 * for an impressive terminal UX.
 */

import ora, { Ora } from "ora";
import chalk from "chalk";
import { ASSET_LABELS, AssetId } from "../constants";

// ============================================================================
// Spinner Helpers
// ============================================================================

/**
 * Create a spinner with Shuffle branding
 */
export function createSpinner(text: string): Ora {
  return ora({
    text: chalk.cyan(text),
    spinner: "dots",
    color: "cyan",
  });
}

/**
 * Run an async operation with a spinner
 */
export async function withSpinner<T>(
  text: string,
  operation: () => Promise<T>,
  successMessage?: string
): Promise<T> {
  const spinner = createSpinner(text);
  spinner.start();
  
  try {
    const result = await operation();
    spinner.succeed(chalk.green(successMessage || text + " ✓"));
    return result;
  } catch (error: any) {
    // Just stop the spinner, let the caller handle error display
    spinner.stop();
    throw error;
  }
}

/**
 * Show a multi-step progress spinner
 */
export function createProgressSpinner(steps: string[]): {
  start: () => void;
  nextStep: () => void;
  succeed: (message?: string) => void;
  fail: (message?: string) => void;
} {
  let currentStep = 0;
  const spinner = createSpinner(steps[0]);

  return {
    start: () => spinner.start(),
    nextStep: () => {
      currentStep++;
      if (currentStep < steps.length) {
        spinner.text = chalk.cyan(steps[currentStep]);
      }
    },
    succeed: (msg?: string) => spinner.succeed(chalk.green(msg || "Complete ✓")),
    fail: (msg?: string) => spinner.fail(chalk.red(msg || "Failed")),
  };
}

// ============================================================================
// Formatted Output
// ============================================================================

/**
 * Print a section header
 */
export function printHeader(title: string): void {
  console.log();
  console.log(chalk.bold.cyan(`🃏 ${title}`));
  console.log(chalk.gray("─".repeat(40)));
}

/**
 * Print balance table showing shielded and unshielded balances side-by-side
 * If pendingPayout is provided, add it to the relevant asset in a different color
 */
export function printBalanceTable(
  shielded: { usdc: bigint; tsla: bigint; spy: bigint; aapl: bigint },
  unshielded?: { usdc: bigint; tsla: bigint; spy: bigint; aapl: bigint },
  pendingPayout?: { amount: bigint; assetId: number } | null,
  solBalanceLamports?: number | bigint
): void {
  printHeader("Your Balances");

  if (solBalanceLamports !== undefined) {
    const sol = Number(solBalanceLamports) / 1_000_000_000;
    let solDisplay: string;
    if (sol === 0) {
      solDisplay = "0.0000";
    } else if (sol < 0.01) {
      solDisplay = sol.toLocaleString("en-US", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
    } else if (sol < 1) {
      solDisplay = sol.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    } else {
      solDisplay = sol.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    console.log(chalk.gray(`  SOL (wallet): ${chalk.white(solDisplay)} SOL`));
    console.log();
  }
  
  const format = (val: bigint) => {
    const num = Number(val) / 1_000_000; // 6 decimals
    // Use more decimal places for small values to avoid showing 0.00 for non-zero amounts
    if (num === 0) {
      return "0.00";
    } else if (num < 0.01) {
      return num.toLocaleString("en-US", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
    } else if (num < 1) {
      return num.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    }
    return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const pad = (str: string, len: number) => str.padStart(len);

  // Map asset IDs to keys: 0=USDC, 1=TSLA, 2=SPY, 3=AAPL
  const assetKeys = ['usdc', 'tsla', 'spy', 'aapl'] as const;

  if (unshielded) {
    // Show both shielded and unshielded
    console.log(chalk.gray("  Token      🔒 Shielded      🔓 Unshielded"));
    console.log();
    
    const printRow = (token: string, color: typeof chalk.yellow, assetId: number, shieldedVal: bigint, unshieldedVal: bigint) => {
      const hasPending = pendingPayout && pendingPayout.assetId === assetId && pendingPayout.amount > 0n;
      const effectiveBalance = hasPending ? shieldedVal + pendingPayout!.amount : shieldedVal;
      
      let shieldedStr: string;
      if (hasPending) {
        // Show effective balance in cyan to indicate pending payout included
        shieldedStr = chalk.cyan(pad(format(effectiveBalance), 12));
      } else {
        shieldedStr = chalk.white(pad(format(shieldedVal), 12));
      }
      
      const unshieldedStr = pad(format(unshieldedVal), 14);
      console.log(`  ${color(token.padEnd(5))}  │ ${shieldedStr}   │ ${chalk.gray(unshieldedStr)}`);
    };

    printRow("USDC", chalk.yellow, 0, shielded.usdc, unshielded.usdc);
    printRow("TSLA", chalk.magenta, 1, shielded.tsla, unshielded.tsla);
    printRow("SPY", chalk.blue, 2, shielded.spy, unshielded.spy);
    printRow("AAPL", chalk.green, 3, shielded.aapl, unshielded.aapl);
  } else {
    // Original format (shielded only)
    console.log(`  ${chalk.yellow("USDC")}: ${chalk.white(format(shielded.usdc))}`);
    console.log(`  ${chalk.magenta("TSLA")}: ${chalk.white(format(shielded.tsla))}`);
    console.log(`  ${chalk.blue("SPY")}:  ${chalk.white(format(shielded.spy))}`);
    console.log(`  ${chalk.green("AAPL")}: ${chalk.white(format(shielded.aapl))}`);
  }
  console.log();
}

/**
 * Print order status
 */
export function printOrderStatus(order: {
  batchId: number;
  pairId: number;
  direction: number;
  amount: bigint;
} | null): void {
  if (!order) {
    console.log(chalk.gray("  No pending order"));
    return;
  }

  const pairLabels = ["TSLA/USDC", "SPY/USDC", "AAPL/USDC", "TSLA/SPY", "TSLA/AAPL", "SPY/AAPL"];
  const directionLabel = order.direction === 0 ? chalk.green("BUY") : chalk.red("SELL");
  const amount = (Number(order.amount) / 1_000_000).toLocaleString();

  console.log(`  Batch:     ${chalk.cyan(order.batchId)}`);
  console.log(`  Pair:      ${chalk.white(pairLabels[order.pairId] || "Unknown")}`);
  console.log(`  Direction: ${directionLabel}`);
  console.log(`  Amount:    ${chalk.white(amount)}`);
}

/**
 * Print batch status
 */
export function printBatchStatus(batch: {
  batchId: number;
  orderCount: number;
}): void {
  console.log(`  Batch ID:     ${chalk.cyan(batch.batchId)}`);
  console.log(`  Order Count:  ${chalk.white(batch.orderCount)}`);
}

/**
 * Print transaction success with explorer link
 */
export function printTxSuccess(signature: string, network: "devnet" | "localnet"): void {
  console.log();
  console.log(chalk.green("✓ Transaction confirmed"));
  
  if (network === "devnet") {
    const url = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
    console.log(chalk.gray(`  View: ${chalk.underline(url)}`));
  } else {
    // Localnet: use custom RPC URL in explorer
    const customUrl = encodeURIComponent("http://localhost:8899");
    const url = `https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=${customUrl}`;
    console.log(chalk.gray(`  View: ${chalk.underline(url)}`));
  }
  console.log();
}

/**
 * Print error message
 */
export function printError(message: string): void {
  console.log();
  console.log(chalk.red(`✗ Error: ${message}`));
  console.log();
}

/**
 * Print info message
 */
export function printInfo(message: string): void {
  console.log(chalk.cyan(`ℹ ${message}`));
}

/**
 * Print success message
 */
export function printSuccess(message: string): void {
  console.log(chalk.green(`✓ ${message}`));
}

/**
 * Print mock mode warning
 */
export function printMockWarning(): void {
  console.log(chalk.yellow("⚠ Running in mock mode - no blockchain interaction"));
}

/**
 * Print batch history table
 */
export function printBatchHistory(
  logs: Array<{
    batchId: number;
    results: Array<{
      totalAIn: { toString: () => string };
      totalBIn: { toString: () => string };
      finalPoolA: { toString: () => string };
      finalPoolB: { toString: () => string };
    }>;
  }>
): void {
  printHeader("Batch History");

  if (logs.length === 0) {
    console.log(chalk.gray("  No executed batches found."));
    console.log(chalk.gray("  Batches are executed when 8+ orders accumulate."));
    console.log();
    return;
  }

  const pairLabels = ["TSLA/USDC", "SPY/USDC", "AAPL/USDC", "TSLA/SPY", "TSLA/AAPL", "SPY/AAPL"];

  const format = (val: string) => {
    const num = Number(val) / 1_000_000; // 6 decimals
    if (num === 0) return chalk.gray("-");
    return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  for (const log of logs) {
    console.log();
    console.log(chalk.bold.white(`  Batch #${log.batchId}`));
    console.log(chalk.gray("  " + "─".repeat(50)));
    
    // Check if there was any activity
    let hasActivity = false;
    for (let i = 0; i < log.results.length; i++) {
      const r = log.results[i];
      const totalAIn = r.totalAIn.toString();
      const totalBIn = r.totalBIn.toString();
      
      if (totalAIn !== "0" || totalBIn !== "0") {
        hasActivity = true;
        const [baseAsset, quoteAsset] = pairLabels[i].split("/");
        
        console.log(`    ${chalk.cyan(pairLabels[i])}:`);
        console.log(`      ${chalk.gray("Inflow")}  ${baseAsset}: ${format(totalAIn)}  ${quoteAsset}: ${format(totalBIn)}`);
        console.log(`      ${chalk.gray("Pool")}    A: ${format(r.finalPoolA.toString())}  B: ${format(r.finalPoolB.toString())}`);
      }
    }
    
    if (!hasActivity) {
      console.log(chalk.gray("    No trading activity"));
    }
  }

  console.log();
  console.log(chalk.gray(`  Total batches executed: ${logs.length}`));
  console.log();
}
