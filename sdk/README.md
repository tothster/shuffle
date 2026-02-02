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

   # Get devnet SOL
   solana airdrop 2
   ```

### Commands

```bash
# Create your privacy account
shuffle init

# View encrypted balances
shuffle balance

# Get test tokens (devnet)
shuffle faucet 10000

# Deposit into privacy account
shuffle deposit USDC 1000

# Withdraw from privacy account
shuffle withdraw USDC 500

# Private transfer to another user
shuffle transfer <solana-address> 100

# Place encrypted order
shuffle order TSLA_USDC buy 500

# Check status
shuffle status

# Settle order after batch execution
shuffle settle
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
