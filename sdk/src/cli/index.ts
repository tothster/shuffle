#!/usr/bin/env node
/**
 * Shuffle CLI - Command Line Interface for Shuffle Privacy Protocol
 * 
 * This CLI wraps the ShuffleClient SDK to provide terminal-based
 * interaction with the Shuffle protocol on Solana.
 */

// Suppress punycode deprecation warning from dependencies
process.removeAllListeners('warning');
const originalEmit = process.emit;
// @ts-ignore
process.emit = function (event: string, warning: any) {
  if (event === 'warning' && warning?.name === 'DeprecationWarning' && 
      warning?.message?.includes('punycode')) {
    return false;
  }
  return originalEmit.apply(process, arguments as any);
};

import { Command } from "commander";
import chalk from "chalk";
import {
  initCommand,
  balanceCommand,
  depositCommand,
  withdrawCommand,
  transferCommand,
  orderCommand,
  executeCommand,
  settleCommand,
  statusCommand,
  faucetCommand,
  airdropCommand,
  historyCommand,
} from "./commands";
import { loadConfig, getVersion, saveConfig, getSavedConfig } from "./config";

const program = new Command();

program
  .name("shuffle")
  .description(chalk.cyan("🃏 Shuffle Protocol CLI - Private DeFi on Solana"))
  .version(getVersion())
  .option("-n, --network <network>", "Network to use (devnet|localnet)")
  .option("-k, --keypair <path>", "Path to keypair file")
  .option("-u, --user <name>", "User profile name (creates separate keys)")
  .option("--mock", "Run in mock mode (no blockchain interaction)")
  .hook("preAction", async (thisCommand) => {
    // Skip config loading for the config command itself
    if (thisCommand.args[0] === "config") return;
    
    // Load config before any command runs
    const opts = thisCommand.opts();
    await loadConfig(opts);
  });

// Config command (doesn't need preAction hook)
const configCmd = program
  .command("config")
  .description("Manage CLI configuration");

configCmd
  .command("set <key> <value>")
  .description("Set a config value (e.g., 'shuffle config set network localnet' or 'shuffle config set mock true')")
  .action((key: string, value: string) => {
    if (key === "network") {
      if (!["devnet", "localnet"].includes(value)) {
        console.log(chalk.red(`❌ Invalid network: ${value}. Use 'devnet' or 'localnet'.`));
        return;
      }
    }
    if (key === "mock") {
      if (!["true", "false"].includes(value.toLowerCase())) {
        console.log(chalk.red(`❌ Invalid value: ${value}. Use 'true' or 'false'.`));
        return;
      }
      value = value.toLowerCase();
    }
    saveConfig(key, value);
    console.log(chalk.green(`✓ Set ${key} = ${value}`));
    console.log(chalk.gray(`  Saved to ~/.shuffle/config.json`));
  });

configCmd
  .command("get [key]")
  .description("Get a config value or show all config")
  .action((key?: string) => {
    if (key) {
      const value = getSavedConfig(key);
      if (value) {
        console.log(`${key}: ${chalk.cyan(value)}`);
      } else {
        console.log(chalk.gray(`${key}: (not set)`));
      }
    } else {
      // Show all config
      const network = getSavedConfig("network") || "(default: devnet)";
      const mock = getSavedConfig("mock") || "false";
      console.log(chalk.cyan("\n🃏 Shuffle Config\n"));
      console.log(`  network: ${chalk.white(network)}`);
      console.log(`  mock:    ${chalk.white(mock)}`);
      console.log(chalk.gray(`\n  Config file: ~/.shuffle/config.json\n`));
    }
  });

// Account Management
program
  .command("init")
  .description("Create a new privacy account")
  .action(initCommand);

program
  .command("balance")
  .description("View your encrypted balances")
  .action(balanceCommand);

// Token Operations
program
  .command("deposit <asset> <amount>")
  .alias("shield")
  .description("Deposit (shield) tokens into your privacy account")
  .action(depositCommand);

program
  .command("withdraw <asset> <amount>")
  .alias("unshield")
  .description("Withdraw (unshield) tokens from your privacy account")
  .action(withdrawCommand);

program
  .command("transfer <address> <amount>")
  .description("Send USDC privately to another user")
  .action(transferCommand);

// Trading
program
  .command("order [pair] [direction] [amount]")
  .description("Place an encrypted order (interactive if no args, or: shuffle order TSLA_USDC buy 100)")
  .action(orderCommand);

program
  .command("execute")
  .description("Trigger batch execution (requires 8+ orders)")
  .action(executeCommand);

program
  .command("settle")
  .description("Settle your pending order after batch execution")
  .action(settleCommand);

program
  .command("status")
  .description("View batch info and pending order status")
  .action(statusCommand);

// Devnet Utilities
program
  .command("faucet <amount>")
  .description("Claim devnet USDC (also airdrops 1 SOL for transaction fees)")
  .action(faucetCommand);


program
  .command("airdrop [amount]")
  .description("Airdrop SOL to your wallet (default: 2 SOL)")
  .action(airdropCommand);

// History
program
  .command("history")
  .description("View all executed batch logs")
  .action(historyCommand);

// Parse and run, then exit to avoid hanging from open connections
program.parseAsync().then(() => {
  // Give a moment for any final I/O to flush
  setTimeout(() => process.exit(0), 100);
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
