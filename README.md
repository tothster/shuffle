```
   _____ _    _ _    _ ______ ______ _      ______ 
  / ____| |  | | |  | |  ____|  ____| |    |  ____|
 | (___ | |__| | |  | | |__  | |__  | |    | |__   
  \___ \|  __  | |  | |  __| |  __| | |    |  __|  
  ____) | |  | | |__| | |    | |    | |____| |____ 
 |_____/|_|  |_|\____/|_|    |_|    |______|______|
```

# The Missing Privacy Layer for Solana DeFi

> **Private trading. Public liquidity. Best execution.**

[![Solana](https://img.shields.io/badge/Solana-Hackathon-9945FF?style=for-the-badge&logo=solana)](https://solana.com)
[![Arcium](https://img.shields.io/badge/Arcium-MPC%20Track-6366F1?style=for-the-badge)](https://arcium.com)
[![Helius](https://img.shields.io/badge/Helius-RPC%20%2B%20Cranker-FF6B00?style=for-the-badge)](https://helius.dev)

---

## 🎯 The Problem

**$1.5B+ extracted by MEV bots on Solana annually.** Every trade signals your intentions to the entire network. Bots frontrun you. Competitors see your accumulation strategy. Institutions can't place large orders without moving markets.

DeFi has a fundamental transparency problem.

---

## 💡 The Solution: Shuffle

Shuffle is the **first protocol** to bridge Privacy 2.0 encrypted computation with public DEX liquidity.

| Step | What Happens | Privacy |
|------|--------------|---------|
| **🛡️ Shield** | Deposit SPL tokens into encrypted balances | Only you can see your balance |
| **🔄 Trade** | Place encrypted orders (pair, direction, amount all hidden) | Orders aggregate privately |
| **💰 Settle** | Automatic pro-rata payouts on next interaction | Settlement amounts encrypted |

**No tradeoffs.** Privacy AND best price via Jupiter's $4B+ liquidity.

---

## 🏗️ Architecture

```mermaid
flowchart TB
    subgraph User["👤 User"]
        Wallet["Wallet + x25519 Key"]
    end
    
    subgraph SDK["📦 Shuffle SDK/CLI"]
        Encrypt["Encrypt orders locally"]
        Decrypt["Decrypt balances"]
    end
    
    subgraph Solana["⛓️ Solana"]
        Program["Shuffle Program (Anchor)"]
        Vaults["SPL Token Vaults"]
    end
    
    subgraph Arcium["🔐 Arcium MPC"]
        Circuits["8 Custom Circuits"]
    end
    
    subgraph External["🌐 External"]
        Jupiter["Jupiter Aggregator"]
        Helius["Helius RPC + Cranker"]
    end
    
    Wallet --> Encrypt --> Program
    Program <--> Circuits
    Program --> Vaults
    Program -.->|Net surplus swap| Jupiter
    Helius -.->|Batch trigger| Program
    Program --> Decrypt --> Wallet
```

For technical deep-dive, see:
- [Privacy 2.0 Concept](docs/TECHNICAL_OVERVIEW.md#privacy-20-the-missing-piece)
- [Omni-Batch Innovation](docs/TECHNICAL_OVERVIEW.md#technical-innovation-omni-batch)
- [MPC Circuit Reference](docs/TECHNICAL_OVERVIEW.md#mpc-circuit-reference)

---

## 🔌 Sponsor Integrations

### Arcium Track — MPC Encrypted Computation

We built **8 custom Arcis circuits** for on-chain encrypted computation:

| Circuit | Purpose | Code |
|---------|---------|------|
| `add_balance` | Deposit to encrypted balance | [encrypted-ixs/src/lib.rs](contract/encrypted-ixs/src/lib.rs) |
| `sub_balance` | Withdraw from encrypted balance | ↑ |
| `transfer` | Atomic P2P transfer | ↑ |
| `init_batch_state` | Create encrypted batch | ↑ |
| `accumulate_order` | Add order to batch, deduct from user | ↑ |
| `reveal_batch` | Decrypt aggregate totals for netting | ↑ |
| `calculate_payout` | Pro-rata settlement computation | ↑ |

**Key integration points:**
- MXE encrypted shared state (`Enc<Shared, T>` and `Enc<Mxe, T>`)
- Computation callbacks for async MPC results
- x25519 key exchange for user-side decryption

### Helius Track — Infrastructure

| Component | Integration |
|-----------|-------------|
| **RPC** | Devnet/Mainnet node access for all transactions |
| **Cranker** | Automated batch trigger when thresholds met (≥8 orders, ≥2 active pairs) |

### Solana Ecosystem

| Component | Integration |
|-----------|-------------|
| **Anchor 0.32** | Smart contract framework with PDAs |
| **SPL Tokens** | 4 assets: USDC, TSLA, SPY, AAPL |
| **Jupiter CPI** | Net surplus routing for best execution |

---

## 🚀 Quick Start

### CLI Installation

```bash
npm install -g @shuffle/cli
```

### Basic Usage

```bash
# Create your privacy account
shuffle init

# View encrypted balances (decrypts locally)
shuffle balance

# Deposit tokens into privacy account
shuffle deposit USDC 1000

# Place encrypted order
shuffle order TSLA_USDC buy 500

# Check order status
shuffle status

# Settle after batch execution
shuffle settle
```

### SDK Usage

```typescript
import { ShuffleClient, AssetId, PairId, Direction } from "@shuffle/cli";

// Initialize client
const client = await ShuffleClient.create({ connection, wallet });
client.initEncryption(yourX25519PrivateKey);

// Create privacy account
await client.createUserAccount();

// Deposit and trade
await client.deposit(AssetId.USDC, 1_000_000_000); // 1000 USDC
await client.placeOrder(PairId.TSLA_USDC, Direction.BtoA, 500_000_000);

// Check balance (decrypts all 4 assets)
const balances = await client.getBalance();
console.log("USDC:", balances.usdc);
```

---

## 🎬 Demo

<!-- TODO: Add demo video link -->
> 🎥 **Video Demo**: [[Link]](https://drive.google.com/file/d/1XJjiBkKVjA-4BHtwMCafhziieIOoUlX0/view)

### Run Locally

```bash
# Clone and setup
git clone https://github.com/your-repo/sol-privacy-mvp
cd sol-privacy-mvp/contract

# Build with Arcium
arcium build

# Run tests
arcium test
```

---

## 🔒 What's Private vs Public

| Data | Encrypted? | Who Can See |
|------|------------|-------------|
| User balances | ✅ Yes | User only (decrypts locally) |
| Order pair/direction/amount | ✅ Yes | User only |
| Settlement payouts | ✅ Yes | User only |
| Account exists | ❌ No | Public |
| Batch order count | ❌ No | Public |
| Aggregate totals (post-batch) | ❌ No | Public |

We're surgical about privacy—see [Data Visibility Matrix](docs/TECHNICAL_OVERVIEW.md#encrypted-vs-non-encrypted-data).

---

## 👥 Team

|  |  |
|--|--|
| **Bulldozer** | [@BulldozerFi](https://x.com/BulldozerFi) — DeFi developer with neobank clients, mainnet deployments securing user funds, cybersecurity background |
| **Tothster** | [@itstothster](https://x.com/itstothster) — Experienced DeFi builder, mainnet dapps, cybersecurity foundations |

Built in a single hackathon sprint. 🚀

---

## 📁 Repository Structure

```
sol-privacy-mvp/
├── contract/               # Anchor + Arcium smart contract
│   ├── programs/           # Shuffle Program (Rust)
│   ├── encrypted-ixs/      # Arcis MPC circuits
│   └── tests/              # Integration tests
├── sdk/                    # TypeScript SDK + CLI
├── frontend/               # Next.js 14 app
├── faucet/                 # Test token faucet
└── docs/                   # Technical documentation
```


---

<p align="center">
  <strong>Private trading. Public liquidity. Best execution.</strong><br>
  Built with ❤️ on Solana using Arcium MPC + Helius
</p>
