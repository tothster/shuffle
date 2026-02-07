# @shuffle-protocol/sdk

**CLI and SDK for the Shuffle Privacy Protocol on Solana**

Shuffle is a privacy-preserving DeFi protocol that uses Multi-Party Computation (MPC) to hide your trading intent until batch execution.

## 🚀 Quick Start

### Installation

```bash
npm install -g @shuffle-protocol/sdk
```

### Prerequisites

1. **Solana CLI** with a keypair:

   ```bash
   # Generate if you don't have one
   solana-keygen new

   # Configure for devnet
   solana config set --url devnet
   ```

### Get Started (Devnet)

```bash
# 1. Create your privacy account
shuffle init

# 2. Get test tokens (also airdrops 1 SOL for fees)
shuffle faucet 10000

# 3. Deposit into privacy account
shuffle shield USDC 1000

# 4. Place encrypted order
shuffle order TSLA_USDC buy 500

# Check status
shuffle status

# Settle order after batch execution
shuffle settle
```

### Other Commands

```bash
# View encrypted balances
shuffle balance

# Withdraw from privacy account
shuffle unshield USDC 500

# Private transfer to another user
shuffle transfer <solana-address> 100

# Get more SOL if needed
shuffle airdrop 2
```

## 📦 SDK Usage

```typescript
import {
  ShuffleClient,
  AssetId,
  PairId,
  Direction,
} from "@shuffle-protocol/sdk";

// Create client
const client = await ShuffleClient.create({
  connection,
  wallet,
});

// Initialize encryption
client.initEncryption(yourX25519PrivateKey);

// Create account
await client.createUserAccount();

// Deposit
await client.deposit(AssetId.USDC, 1_000_000_000); // 1000 USDC

// Check balance
const balances = await client.getBalance();
console.log("USDC:", balances.usdc);

// Place order
await client.placeOrder(
  PairId.TSLA_USDC,
  Direction.AtoB, // Buy TSLA with USDC
  500_000_000, // 500 USDC
  AssetId.USDC,
);
```

## 🃏 How It Works

1. **Deposit** tokens into your private account
2. **Place orders** that are encrypted using MPC
3. **Batch execution** aggregates all orders privately
4. **Settle** to receive your pro-rata payout

Your trading intent remains hidden until the batch executes!

## 🔧 Options

```bash
shuffle --help                    # Show all commands
shuffle --network localnet        # Use local validator
shuffle --keypair ~/custom.json   # Use custom keypair
shuffle --mock                    # Mock mode for testing
```

## License

MIT
