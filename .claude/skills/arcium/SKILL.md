---
name: arcium
description: Build privacy-preserving applications using Arcium's MPC (Multi-Party Computation) framework on Solana. Use when developing encrypted computations, confidential DeFi, private voting, sealed-bid auctions, hidden-information games, or any application requiring data to remain encrypted during processing. Covers Arcis circuit development, Solana program integration, TypeScript client encryption, and testing.
---

# Arcium Development Skill

Build privacy-preserving applications using Multi-Party Computation (MPC) on Solana.

## Overview

Arcium enables computations on encrypted data without decryption. Use this skill when building:
- **Confidential DeFi**: Dark pools, private order books
- **Private voting**: Encrypted tallies, anonymous ballots
- **Hidden-information games**: Card games, auctions
- **Secure data processing**: Medical records, credentials

## Quick Start

### Project Setup
```bash
# Install Arcium CLI
curl --proto '=https' --tlsv1.2 -sSfL https://install.arcium.com/ | bash

# Initialize project
arcium init <project-name>

# Build and test
arcium build
arcium test
```

### Project Structure
```
my-project/
├── Arcium.toml          # Arcium configuration
├── encrypted-ixs/       # Arcis circuits (MPC code)
│   └── src/lib.rs
├── programs/            # Solana program (Anchor)
│   └── src/lib.rs
└── tests/               # TypeScript integration tests
```

## Workflow Decision Tree

```
Need encrypted computation?
├── Stateless operation (e.g., coinflip, verification)
│   └── Use simple #[instruction] with .reveal() output
├── Need to store encrypted state between calls
│   └── Use Enc<Mxe, T> for MXE-owned state accounts
├── Complex multi-step flow (e.g., game, auction)
│   └── Multiple instructions + encrypted state + callbacks
└── Need randomness
    └── Use ArcisRNG (MPC-secure, no single party controls)
```

## Core Arcis Patterns

### Pattern 1: Stateless Operation (Coinflip)
No state stored, immediate result:

```rust
use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    pub struct UserChoice {
        pub choice: bool,
    }

    #[instruction]
    pub fn flip(input_ctxt: Enc<Shared, UserChoice>) -> bool {
        let input = input_ctxt.to_arcis();
        let toss = ArcisRNG::bool();  // MPC-secure random
        (input.choice == toss).reveal()
    }
}
```

### Pattern 2: Encrypted State (Voting)
MXE-owned state persists between calls:

```rust
pub struct VoteStats {
    yes: u64,
    no: u64,
}

#[instruction]
pub fn init_vote_stats(mxe: Mxe) -> Enc<Mxe, VoteStats> {
    mxe.from_arcis(VoteStats { yes: 0, no: 0 })
}

#[instruction]
pub fn vote(
    vote_ctxt: Enc<Shared, UserVote>,
    vote_stats_ctxt: Enc<Mxe, VoteStats>,
) -> Enc<Mxe, VoteStats> {
    let user_vote = vote_ctxt.to_arcis();
    let mut vote_stats = vote_stats_ctxt.to_arcis();
    
    if user_vote.vote {
        vote_stats.yes += 1;
    } else {
        vote_stats.no += 1;
    }
    
    vote_stats_ctxt.owner.from_arcis(vote_stats)
}

#[instruction]
pub fn reveal_result(vote_stats_ctxt: Enc<Mxe, VoteStats>) -> bool {
    let stats = vote_stats_ctxt.to_arcis();
    (stats.yes > stats.no).reveal()
}
```

### Pattern 3: Encrypted Comparison (Auction)
Compare values without revealing them:

```rust
pub struct Bid {
    pub bidder_lo: u128,
    pub bidder_hi: u128,
    pub amount: u64,
}

pub struct AuctionState {
    pub highest_bid: u64,
    pub highest_bidder_lo: u128,
    pub highest_bidder_hi: u128,
    pub second_highest_bid: u64,
}

#[instruction]
pub fn place_bid(
    bid_ctxt: Enc<Shared, Bid>,
    state_ctxt: Enc<Mxe, AuctionState>,
) -> Enc<Mxe, AuctionState> {
    let bid = bid_ctxt.to_arcis();
    let mut state = state_ctxt.to_arcis();

    if bid.amount > state.highest_bid {
        state.second_highest_bid = state.highest_bid;
        state.highest_bid = bid.amount;
        state.highest_bidder_lo = bid.bidder_lo;
        state.highest_bidder_hi = bid.bidder_hi;
    } else if bid.amount > state.second_highest_bid {
        state.second_highest_bid = bid.amount;
    }

    state_ctxt.owner.from_arcis(state)
}
```

## Key Concepts

### Encryption Types
| Type | Who Can Decrypt | Use Case |
|------|-----------------|----------|
| `Enc<Shared, T>` | Client + MXE | User inputs/outputs |
| `Enc<Mxe, T>` | MXE only | Protocol state |

### Data Flow
```
input.to_arcis()     // Encrypted → secret shares
// ... compute on shares ...
owner.from_arcis(x)  // Secret shares → encrypted
value.reveal()       // Decrypt to plaintext (use carefully!)
```

### Limitations
| Supported | Not Supported |
|-----------|---------------|
| `if`, `else`, `for` loops | `while`, `match`, `break` |
| Integers, floats, arrays, structs | `Vec`, `String`, `HashMap` |
| Closures, generics | Recursion, async |

## Debugging Quick Start

When something fails, check in this order:

1. **Build errors**: `Box<>` wrap large accounts, check Solana version is 2.3.x
2. **Test failures**: Check account exists before creating, add retry logic for blockhash
3. **MPC timeout**: Check node logs (`artifacts/arx_node_logs/`), increase timeout
4. **Callback undefined**: Ensure `buildFinalizeCompDefTx` called after init comp def

```bash
# Clean state and retry
rm -rf .anchor/test-ledger && arcium test

# Check MPC logs
cat artifacts/arx_node_logs/*.log | tail -50

# Verify SDK version
cat node_modules/@arcium-hq/client/package.json | grep version
```

See [references/debugging.md](references/debugging.md) for detailed patterns.

## Resources

### Development
- **Arcis Syntax**: See [references/arcis-reference.md](references/arcis-reference.md)
- **Implementation Patterns**: See [references/patterns.md](references/patterns.md)
- **Solana Integration**: See [references/solana-integration.md](references/solana-integration.md)
- **Testing Guide**: See [references/testing.md](references/testing.md)
- **Migration to v0.7.0**: See [references/migration-v0.7.0.md](references/migration-v0.7.0.md)

### Troubleshooting
- **Debugging Guide**: See [references/debugging.md](references/debugging.md)
- **Build & Installation**: See [references/build-troubleshooting.md](references/build-troubleshooting.md)

### External Documentation
- [Arcium Docs](https://docs.arcium.com/developers)
- [Hello World Tutorial](https://docs.arcium.com/developers/hello-world)
- [Arcis Quick Reference](https://docs.arcium.com/developers/arcis/quick-reference)
- [TypeScript SDK](https://ts.arcium.com/api)
- [Example Repository](https://github.com/arcium-hq/examples)
