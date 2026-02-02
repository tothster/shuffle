/**
 * Balance Tracking Utilities for Shuffle Protocol
 *
 * Since on-chain balances are encrypted with MXE key (not user key),
 * the client must track balances locally after each operation.
 *
 * Usage:
 * 1. Call initBalanceTracker() when user creates account or after first deposit
 * 2. Call trackDeposit/trackWithdrawal/etc. after each operation
 * 3. Use getBalance() to read current balance
 * 4. Use isInSync() to verify local tracker matches on-chain nonce
 */

import type { PublicKey } from "@solana/web3.js";

/**
 * Asset types supported by the protocol
 */
export type Asset = "usdc" | "xaapl" | "xtsla" | "xgoog";

/**
 * Client-side balance tracker for a user's privacy account.
 * Tracks balances locally since on-chain data is MXE-encrypted.
 */
export interface BalanceTracker {
  /** User's wallet public key */
  owner: PublicKey;
  /** USDC balance in base units (6 decimals) */
  usdc: bigint;
  /** xAAPL balance in base units */
  xaapl: bigint;
  /** xTSLA balance in base units */
  xtsla: bigint;
  /** xGOOG balance in base units */
  xgoog: bigint;
  /** Last known on-chain nonce (for sync verification) */
  lastKnownNonce: bigint;
}

/**
 * Initialize a new balance tracker for a user.
 * Call this when user creates their privacy account.
 *
 * @param owner - User's wallet public key
 * @returns New BalanceTracker with zero balances
 */
export function initBalanceTracker(owner: PublicKey): BalanceTracker {
  return {
    owner,
    usdc: 0n,
    xaapl: 0n,
    xtsla: 0n,
    xgoog: 0n,
    lastKnownNonce: 0n,
  };
}

/**
 * Update tracker after a deposit.
 *
 * @param tracker - The balance tracker to update
 * @param asset - Which asset was deposited
 * @param amount - Amount deposited in base units
 * @param newNonce - New nonce from the on-chain account after deposit
 */
export function trackDeposit(
  tracker: BalanceTracker,
  asset: Asset,
  amount: bigint,
  newNonce: bigint
): void {
  tracker[asset] += amount;
  tracker.lastKnownNonce = newNonce;
}

/**
 * Update tracker after a withdrawal.
 *
 * @param tracker - The balance tracker to update
 * @param asset - Which asset was withdrawn
 * @param amount - Amount withdrawn in base units
 * @param newNonce - New nonce from the on-chain account after withdrawal
 */
export function trackWithdrawal(
  tracker: BalanceTracker,
  asset: Asset,
  amount: bigint,
  newNonce: bigint
): void {
  tracker[asset] -= amount;
  tracker.lastKnownNonce = newNonce;
}

/**
 * Update tracker after receiving an internal transfer.
 *
 * @param tracker - Recipient's balance tracker
 * @param asset - Which asset was received
 * @param amount - Amount received in base units
 * @param newNonce - New nonce from the on-chain account
 */
export function trackIncomingTransfer(
  tracker: BalanceTracker,
  asset: Asset,
  amount: bigint,
  newNonce: bigint
): void {
  tracker[asset] += amount;
  tracker.lastKnownNonce = newNonce;
}

/**
 * Update tracker after sending an internal transfer.
 *
 * @param tracker - Sender's balance tracker
 * @param asset - Which asset was sent
 * @param amount - Amount sent in base units
 * @param newNonce - New nonce from the on-chain account
 */
export function trackOutgoingTransfer(
  tracker: BalanceTracker,
  asset: Asset,
  amount: bigint,
  newNonce: bigint
): void {
  tracker[asset] -= amount;
  tracker.lastKnownNonce = newNonce;
}

/**
 * Get the current balance for an asset.
 *
 * @param tracker - The balance tracker
 * @param asset - Which asset to query
 * @returns Balance in base units
 */
export function getBalance(tracker: BalanceTracker, asset: Asset): bigint {
  return tracker[asset];
}

/**
 * Get balance formatted with decimals (for display).
 *
 * @param tracker - The balance tracker
 * @param asset - Which asset to query
 * @param decimals - Number of decimal places (default 6 for USDC)
 * @returns Balance as human-readable string (e.g., "100.50")
 */
export function getBalanceFormatted(
  tracker: BalanceTracker,
  asset: Asset,
  decimals: number = 6
): string {
  const balance = tracker[asset];
  const divisor = BigInt(10 ** decimals);
  const whole = balance / divisor;
  const fraction = balance % divisor;
  const fractionStr = fraction.toString().padStart(decimals, "0");
  return `${whole}.${fractionStr}`;
}

/**
 * Verify local tracker is in sync with on-chain account.
 *
 * @param tracker - The local balance tracker
 * @param onChainNonce - Nonce read from the on-chain UserPrivacyAccount
 * @returns true if in sync, false if external update detected
 */
export function isInSync(tracker: BalanceTracker, onChainNonce: bigint): boolean {
  return tracker.lastKnownNonce === onChainNonce;
}

/**
 * Check if an external update occurred (someone sent you a transfer).
 * Returns the nonce difference, which indicates how many operations
 * were performed without this client's knowledge.
 *
 * @param tracker - The local balance tracker
 * @param onChainNonce - Nonce read from the on-chain UserPrivacyAccount
 * @returns Number of missed operations (0 if in sync)
 */
export function getMissedOperations(
  tracker: BalanceTracker,
  onChainNonce: bigint
): bigint {
  if (onChainNonce > tracker.lastKnownNonce) {
    return onChainNonce - tracker.lastKnownNonce;
  }
  return 0n;
}

/**
 * Sync tracker with on-chain nonce after detecting external updates.
 * Note: This only updates the nonce - balances must be re-fetched via MPC
 * if you need accurate values after external updates.
 *
 * @param tracker - The balance tracker to update
 * @param onChainNonce - Current nonce from on-chain account
 */
export function syncNonce(tracker: BalanceTracker, onChainNonce: bigint): void {
  tracker.lastKnownNonce = onChainNonce;
}
