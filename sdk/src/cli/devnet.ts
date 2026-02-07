/**
 * Devnet Configuration and Mock Mode
 * 
 * Contains easily-updatable constants for devnet deployment.
 * When MOCK_MODE is true, all operations simulate responses.
 */

import { PublicKey } from "@solana/web3.js";

// ============================================================================
// DEVNET CONSTANTS - Update these when contracts are deployed
// ============================================================================

/**
 * Set to false for live blockchain interaction
 */
export const MOCK_MODE = false;

/**
 * Localnet program configuration (from arcium test)
 * NOTE: This is automatically updated by setup-local.js
 */
export const LOCALNET_CONFIG = {
  programId: new PublicKey("DQ29rUToHVTyp2QxP3C7nt1MuYp6p6PKYNaDpGooPAFq"),
  rpcUrl: "http://127.0.0.1:8899",
};

/**
 * Devnet program and token configuration
 */
export const DEVNET_CONFIG = {
  // Program ID from successful devnet deployment (2026-02-03 v0.7.0 - fresh deploy with synced IDs)
  programId: new PublicKey("D5hXtvqYeBHM4f8DqJuYyioPNDsQS6jhSRqj9DmFFvCH"),
  rpcUrl: "https://devnet.helius-rpc.com/?api-key=a8e1a5ce-29c6-4356-b3f9-54c1c650ac08",

  // Arcium cluster offset for v0.7.0 (required for account derivations)
  clusterOffset: 456,
  
  // Token mints - deployed 2026-02-01
  mints: {
    USDC: new PublicKey("2rGgkS8piPnFbJxLhyyfXnTuLqPW8zPoM7YXnovjBK9s"),
    TSLA: new PublicKey("EmRuN3yRqizBKwVSahm6bPW4YEUZ4iGcP95SQg1MdDfZ"),
    SPY: new PublicKey("HgaWt2CGQLT3RTNt4HQpCFhMpeo8amadH6KcQ5gVCDvQ"),
    AAPL: new PublicKey("7JohqPXEVJ3Mm8TrHf7KQ7F4Nq4JnxvfTLQFn4D5nghj"),
  },

  // Faucet authority - update with deployed faucet program or mint authority
  faucetAuthority: null as PublicKey | null,
};

// ============================================================================
// MOCK RESPONSES - Used when MOCK_MODE is true
// ============================================================================

/**
 * Simulated delay for mock operations (milliseconds)
 */
export const MOCK_DELAY = {
  fast: 800,      // Balance queries
  medium: 2000,   // Deposits, withdrawals
  slow: 4000,     // MPC operations (orders, settlements)
};

/**
 * Mock state for simulating operations
 */
export interface MockState {
  accountExists: boolean;
  balances: {
    usdc: bigint;
    tsla: bigint;
    spy: bigint;
    aapl: bigint;
  };
  pendingOrder: {
    batchId: number;
    pairId: number;
    direction: number;
    amount: bigint;
  } | null;
  batchId: number;
}

let mockState: MockState = {
  accountExists: true, // Pre-initialized for smooth demo
  balances: { usdc: 0n, tsla: 0n, spy: 0n, aapl: 0n },
  pendingOrder: null,
  batchId: 1,
};

/**
 * Get current mock state
 */
export function getMockState(): MockState {
  return mockState;
}

/**
 * Update mock state
 */
export function updateMockState(updates: Partial<MockState>): void {
  mockState = { ...mockState, ...updates };
}

/**
 * Reset mock state
 */
export function resetMockState(): void {
  mockState = {
    accountExists: false,
    balances: { usdc: 0n, tsla: 0n, spy: 0n, aapl: 0n },
    pendingOrder: null,
    batchId: 1,
  };
}

/**
 * Simulate async delay
 */
export function mockDelay(type: keyof typeof MOCK_DELAY): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, MOCK_DELAY[type]));
}

/**
 * Generate a fake transaction signature
 */
export function mockSignature(): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let sig = "";
  for (let i = 0; i < 88; i++) {
    sig += chars[Math.floor(Math.random() * chars.length)];
  }
  return sig;
}
