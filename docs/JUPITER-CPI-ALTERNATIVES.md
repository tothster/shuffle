# Jupiter CPI Integration - Alternative Approaches

This document describes two approaches for implementing real Jupiter swap integration in the batch execution callback, as alternatives to the current simulation-based approach.

## Current Implementation (MVP - Simulation)

The current `reveal_batch_callback` uses **simulated swaps** with 1% slippage:

```rust
// In reveal_batch_callback
let amount_out = (surplus_in_a * 99) / 100; // Simulate 1% slippage
```

**Pros:**
- ✅ Simple implementation
- ✅ Auto-trigger works perfectly (8th order → execute → settle)
- ✅ No off-chain coordination needed
- ✅ Suitable for MVP/testing

**Cons:**
- ❌ Not real swaps
- ❌ Protocol gradually accumulates token imbalances
- ❌ Requires occasional manual rebalancing

**When to upgrade:** When moving from MVP to production with real liquidity.

---

## Alternative 1: Off-Chain Operator Coordination

### Overview

Split batch execution into multiple transactions, coordinated by an off-chain service.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Batch Execution Flow (Off-Chain Coordinated)               │
└─────────────────────────────────────────────────────────────┘

1. Transaction 1: execute_batch
   └─> reveal_batch_callback
       └─> Stores pending swaps in PendingSwaps PDA
           {
             batch_id: 123,
             swaps: [
               { pair_id: 0, sell_asset: TSLA, buy_asset: USDC, amount: 100 },
               { pair_id: 3, sell_asset: SPY, buy_asset: TSLA, amount: 50 },
             ]
           }

2. Off-Chain Service Monitors:
   └─> Detects new PendingSwaps account
   └─> For each swap:
       └─> Transaction: execute_pair_swap(pair_id)
           └─> CPIs to Jupiter
           └─> Updates swap results

3. Transaction: finalize_batch()
   └─> Verifies all swaps complete
   └─> Writes final results to BatchLog
   └─> Clears PendingSwaps
```

### New Account Structure

```rust
/// Temporary storage for swaps that need execution
#[account]
pub struct PendingSwaps {
    pub batch_id: u64,
    pub swaps: Vec<PendingSwap>,  // Max 6 swaps (one per pair)
    pub completed_count: u8,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PendingSwap {
    pub pair_id: u8,
    pub sell_asset: u8,
    pub buy_asset: u8,
    pub amount_in: u64,
    pub min_amount_out: u64,
    pub executed: bool,
    pub actual_amount_out: u64,
}
```

### New Instructions

#### 1. Modified `reveal_batch_callback`

```rust
#[arcium_callback(encrypted_ix = "reveal_batch")]
pub fn reveal_batch_callback(
    ctx: Context<RevealBatchCallbackWithPending>,
    output: SignedComputationOutputs<RevealBatchOutput>,
) -> Result<()> {
    let totals: [u64; 12] = match output.verify_output(...) {
        Ok(RevealBatchOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };

    let mut pending_swaps = vec![];

    // Calculate netting for each pair
    for pair_id in 0..6 {
        let total_a_in = totals[pair_id * 2];
        let total_b_in = totals[pair_id * 2 + 1];

        if total_a_in == 0 && total_b_in == 0 {
            continue;
        }

        // Determine if swap is needed
        let (sell_asset, buy_asset, amount) = calculate_net_surplus(pair_id, total_a_in, total_b_in);

        if amount > 0 {
            pending_swaps.push(PendingSwap {
                pair_id,
                sell_asset,
                buy_asset,
                amount_in: amount,
                min_amount_out: calculate_min_out(amount, sell_asset, buy_asset),
                executed: false,
                actual_amount_out: 0,
            });
        }
    }

    // Store pending swaps
    ctx.accounts.pending_swaps.batch_id = ctx.accounts.batch_accumulator.batch_id;
    ctx.accounts.pending_swaps.swaps = pending_swaps;
    ctx.accounts.pending_swaps.completed_count = 0;

    // Reset batch accumulator
    let batch = &mut ctx.accounts.batch_accumulator;
    batch.batch_id += 1;
    batch.order_count = 0;
    batch.active_pairs = 0;

    msg!("Batch revealed, {} swaps pending", ctx.accounts.pending_swaps.swaps.len());
    Ok(())
}
```

#### 2. New `execute_pair_swap` Instruction

```rust
/// Execute a single pair's Jupiter swap
pub fn execute_pair_swap(
    ctx: Context<ExecutePairSwap>,
    pair_id: u8,
) -> Result<()> {
    let pending = &ctx.accounts.pending_swaps;

    // Find the swap for this pair
    let swap = pending.swaps.iter()
        .find(|s| s.pair_id == pair_id && !s.executed)
        .ok_or(ErrorCode::SwapNotFound)?;

    // Build Jupiter swap CPI
    let swap_ix = build_jupiter_swap_instruction(
        &ctx.accounts.pool,
        swap.sell_asset,
        swap.buy_asset,
        swap.amount_in,
        swap.min_amount_out,
    )?;

    // Execute CPI to Jupiter
    let pool_seeds = &[POOL_SEED, &[ctx.accounts.pool.bump]];
    invoke_signed(
        &swap_ix,
        &[
            ctx.accounts.pool.to_account_info(),
            ctx.accounts.jupiter_program.to_account_info(),
            // ... all Jupiter accounts for this specific pair
        ],
        &[&pool_seeds[..]],
    )?;

    // Update swap status
    let pending_swaps = &mut ctx.accounts.pending_swaps;
    let swap_mut = pending_swaps.swaps.iter_mut()
        .find(|s| s.pair_id == pair_id)
        .unwrap();
    swap_mut.executed = true;
    swap_mut.actual_amount_out = parse_jupiter_output()?; // Parse from return data/events
    pending_swaps.completed_count += 1;

    msg!("Pair {} swap executed: {} in, {} out", pair_id, swap.amount_in, swap_mut.actual_amount_out);
    Ok(())
}

#[derive(Accounts)]
#[instruction(pair_id: u8)]
pub struct ExecutePairSwap<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        seeds = [PENDING_SWAPS_SEED, &pending_swaps.batch_id.to_le_bytes()],
        bump,
    )]
    pub pending_swaps: Account<'info, PendingSwaps>,

    // Jupiter accounts (specific to this pair)
    pub jupiter_program: UncheckedAccount<'info>,
    pub jupiter_swap_pool: UncheckedAccount<'info>,

    // Token mints
    pub sell_mint: Account<'info, Mint>,
    pub buy_mint: Account<'info, Mint>,

    // Protocol vaults
    #[account(mut)]
    pub pool_sell_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub pool_buy_vault: Account<'info, TokenAccount>,

    // Jupiter vaults
    #[account(mut)]
    pub jupiter_sell_vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub jupiter_buy_vault: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}
```

#### 3. New `finalize_batch` Instruction

```rust
/// Finalize batch after all swaps complete
pub fn finalize_batch(ctx: Context<FinalizeBatch>) -> Result<()> {
    let pending = &ctx.accounts.pending_swaps;

    // Verify all swaps executed
    require!(
        pending.completed_count as usize == pending.swaps.len(),
        ErrorCode::SwapsIncomplete
    );

    // Build final PairResults with actual swap outputs
    let mut pair_results = [PairResult::default(); 6];
    for swap in &pending.swaps {
        // Use actual_amount_out from executed swaps
        pair_results[swap.pair_id as usize] = build_result_from_swap(swap);
    }

    // Write to BatchLog
    let batch_log = &mut ctx.accounts.batch_log;
    batch_log.batch_id = pending.batch_id;
    batch_log.results = pair_results;
    batch_log.executed_at = Clock::get()?.unix_timestamp;

    // Close PendingSwaps account
    // (Anchor close constraint would handle this)

    msg!("Batch {} finalized", pending.batch_id);
    Ok(())
}
```

### Off-Chain Service (TypeScript)

```typescript
// service.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';

class BatchSwapExecutor {
  constructor(
    private connection: Connection,
    private program: Program,
    private operatorKeypair: Keypair,
  ) {}

  async monitorAndExecute() {
    // Subscribe to PendingSwaps account creation
    const pendingSwapsFilter = {
      memcmp: {
        offset: 0,
        bytes: /* PendingSwaps discriminator */
      }
    };

    this.connection.onProgramAccountChange(
      this.program.programId,
      async (accountInfo, context) => {
        const pendingSwaps = this.program.account.pendingSwaps.coder.accounts.decode(
          'PendingSwaps',
          accountInfo.accountInfo.data
        );

        // Execute each swap
        for (const swap of pendingSwaps.swaps) {
          if (!swap.executed) {
            await this.executeSwap(pendingSwaps.batchId, swap.pairId);
          }
        }

        // Finalize batch
        await this.finalizeBatch(pendingSwaps.batchId);
      },
      pendingSwapsFilter
    );
  }

  async executeSwap(batchId: number, pairId: number) {
    // Load all accounts needed for this pair's swap
    const accounts = await this.loadSwapAccounts(pairId);

    await this.program.methods
      .executePairSwap(pairId)
      .accounts(accounts)
      .signers([this.operatorKeypair])
      .rpc();

    console.log(`Executed swap for batch ${batchId}, pair ${pairId}`);
  }

  async finalizeBatch(batchId: number) {
    const batchLogPda = PublicKey.findProgramAddressSync(
      [Buffer.from('batch_log'), batchId.toArrayLike(Buffer, 'le', 8)],
      this.program.programId
    )[0];

    await this.program.methods
      .finalizeBatch()
      .accounts({
        pendingSwaps: /* PDA */,
        batchLog: batchLogPda,
        // ...
      })
      .signers([this.operatorKeypair])
      .rpc();

    console.log(`Finalized batch ${batchId}`);
  }
}
```

### Pros & Cons

**Pros:**
- ✅ Real Jupiter swaps with actual DEX liquidity
- ✅ Each swap instruction has minimal accounts (~15)
- ✅ Flexible - only swap pairs that need it
- ✅ Can retry failed swaps
- ✅ Detailed logging per swap

**Cons:**
- ❌ Requires off-chain service (additional infrastructure)
- ❌ Multiple transactions per batch (higher latency)
- ❌ Operator must pay gas for swap transactions
- ❌ Users can't settle until swaps complete (delays)
- ❌ Service must be highly available
- ❌ More complex error handling

### Cost Analysis

- **Per Batch:**
  - 1 execute_batch transaction
  - 0-6 execute_pair_swap transactions (depends on active pairs)
  - 1 finalize_batch transaction
  - Total: 2-8 transactions

- **Gas Cost:** Operator pays for all swap transactions
- **Latency:** ~3-10 seconds depending on number of swaps

---

## Alternative 2: Address Lookup Tables (ALT)

### Overview

Use Solana's Address Lookup Tables to pass all possible swap accounts to the callback in a single transaction.

### What are Address Lookup Tables?

Address Lookup Tables (ALTs) allow referencing accounts by index instead of full 32-byte addresses:
- Normal transaction: 32 accounts limit
- With ALT: Can reference up to 256 accounts
- One-time setup per deployment
- Then use table index (2 bytes) instead of full address (32 bytes)

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Batch Execution Flow (ALT-Based)                           │
└─────────────────────────────────────────────────────────────┘

Setup (One-time per deployment):
  └─> Create Address Lookup Table
      └─> Add all protocol vaults (4)
      └─> Add all token mints (4)
      └─> Add Jupiter program
      └─> Add Jupiter swap pools (6)
      └─> Add Jupiter vaults (12)
      └─> Total: ~30 addresses

Runtime (Every batch):
  1. execute_batch instruction
     └─> References ALT
     └─> All swap accounts available via lookup
     └─> reveal_batch_callback
         └─> Performs netting
         └─> CPIs to Jupiter for each pair with net surplus
         └─> Writes final BatchLog
```

### Implementation

#### 1. One-Time ALT Setup

```typescript
// setup-alt.ts
import {
  Connection,
  Keypair,
  PublicKey,
  AddressLookupTableProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

async function setupAddressLookupTable(
  connection: Connection,
  payer: Keypair,
  programId: PublicKey,
) {
  // Derive all protocol account addresses
  const [pool] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool')],
    programId
  );

  const [vaultUsdc] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), Buffer.from('usdc')],
    programId
  );
  // ... derive all vaults

  // All addresses to include in lookup table
  const addresses = [
    pool,
    vaultUsdc,
    vaultTsla,
    vaultSpy,
    vaultAapl,
    usdcMint,
    tslaMint,
    spyMint,
    aaplMint,
    jupiterProgram,
    // ... all Jupiter pools and vaults
  ];

  // Create lookup table
  const [createIx, lookupTableAddress] =
    AddressLookupTableProgram.createLookupTable({
      authority: payer.publicKey,
      payer: payer.publicKey,
      recentSlot: await connection.getSlot(),
    });

  // Add addresses to table
  const extendIx = AddressLookupTableProgram.extendLookupTable({
    payer: payer.publicKey,
    authority: payer.publicKey,
    lookupTable: lookupTableAddress,
    addresses: addresses,
  });

  // Send transaction
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
      instructions: [createIx, extendIx],
    }).compileToV0Message()
  );

  tx.sign([payer]);
  await connection.sendTransaction(tx);

  console.log('ALT created:', lookupTableAddress.toBase58());
  return lookupTableAddress;
}
```

#### 2. Modified `RevealBatchCallback` Account Structure

```rust
// All accounts available via ALT reference
#[callback_accounts("reveal_batch")]
#[derive(Accounts)]
pub struct RevealBatchCallback<'info> {
    // Standard Arcium callback accounts
    pub arcium_program: Program<'info, Arcium>,
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    pub mxe_account: Account<'info, MXEAccount>,
    pub computation_account: UncheckedAccount<'info>,
    pub cluster_account: Account<'info, Cluster>,
    pub instructions_sysvar: AccountInfo<'info>,

    // Application accounts
    #[account(mut)]
    pub batch_accumulator: Box<Account<'info, BatchAccumulator>>,

    #[account(mut)]
    pub batch_log: Account<'info, BatchLog>,

    pub pool: Box<Account<'info, Pool>>,

    // ======== ALL SWAP ACCOUNTS (via ALT) ========

    // Protocol vaults
    #[account(mut)]
    pub vault_usdc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_tsla: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_spy: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_aapl: Account<'info, TokenAccount>,

    // Token mints
    pub usdc_mint: Account<'info, Mint>,
    pub tsla_mint: Account<'info, Mint>,
    pub spy_mint: Account<'info, Mint>,
    pub aapl_mint: Account<'info, Mint>,

    // Jupiter program
    pub jupiter_program: UncheckedAccount<'info>,

    // Jupiter swap pools (one per pair)
    #[account(mut)]
    pub jupiter_pool_0: UncheckedAccount<'info>, // TSLA/USDC
    #[account(mut)]
    pub jupiter_pool_1: UncheckedAccount<'info>, // SPY/USDC
    #[account(mut)]
    pub jupiter_pool_2: UncheckedAccount<'info>, // AAPL/USDC
    #[account(mut)]
    pub jupiter_pool_3: UncheckedAccount<'info>, // TSLA/SPY
    #[account(mut)]
    pub jupiter_pool_4: UncheckedAccount<'info>, // TSLA/AAPL
    #[account(mut)]
    pub jupiter_pool_5: UncheckedAccount<'info>, // SPY/AAPL

    // Jupiter vaults (2 per pair = 12 total)
    #[account(mut)]
    pub jupiter_vault_0_usdc: UncheckedAccount<'info>,
    #[account(mut)]
    pub jupiter_vault_0_tsla: UncheckedAccount<'info>,
    // ... all 12 vaults

    pub token_program: Program<'info, Token>,
}
```

#### 3. Enhanced Callback with Real Swaps

```rust
#[arcium_callback(encrypted_ix = "reveal_batch")]
pub fn reveal_batch_callback(
    ctx: Context<RevealBatchCallback>,
    output: SignedComputationOutputs<RevealBatchOutput>,
) -> Result<()> {
    let totals: [u64; 12] = match output.verify_output(...) {
        Ok(RevealBatchOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };

    let mut pair_results = [PairResult::default(); 6];

    // Process each pair
    for pair_id in 0..6 {
        let total_a_in = totals[pair_id * 2];
        let total_b_in = totals[pair_id * 2 + 1];

        if total_a_in == 0 && total_b_in == 0 {
            continue;
        }

        // Calculate net surplus
        let (sell_asset, buy_asset, amount) =
            calculate_net_surplus(pair_id, total_a_in, total_b_in);

        let (final_pool_a, final_pool_b) = if amount > 0 {
            // REAL SWAP VIA JUPITER CPI
            let amount_out = execute_jupiter_swap_for_pair(
                &ctx.accounts,
                pair_id,
                sell_asset,
                buy_asset,
                amount,
            )?;

            // Update pools based on actual swap result
            if sell_asset < buy_asset {
                (total_a_in - amount, total_b_in + amount_out)
            } else {
                (total_a_in + amount_out, total_b_in - amount)
            }
        } else {
            // Perfect match, no swap needed
            (total_a_in, total_b_in)
        };

        pair_results[pair_id] = PairResult {
            total_a_in,
            total_b_in,
            final_pool_a,
            final_pool_b,
        };
    }

    // Write final BatchLog
    let batch_log = &mut ctx.accounts.batch_log;
    batch_log.batch_id = ctx.accounts.batch_accumulator.batch_id;
    batch_log.results = pair_results;
    batch_log.executed_at = Clock::get()?.unix_timestamp;

    // Reset BatchAccumulator
    let batch = &mut ctx.accounts.batch_accumulator;
    batch.batch_id += 1;
    batch.order_count = 0;
    batch.active_pairs = 0;

    Ok(())
}

/// Execute Jupiter swap for a specific pair
fn execute_jupiter_swap_for_pair<'info>(
    accounts: &RevealBatchCallback<'info>,
    pair_id: u8,
    sell_asset: u8,
    buy_asset: u8,
    amount_in: u64,
) -> Result<u64> {
    // Select the correct accounts for this pair
    let (
        sell_vault,
        buy_vault,
        sell_mint,
        buy_mint,
        jupiter_pool,
        jupiter_sell_vault,
        jupiter_buy_vault,
    ) = match pair_id {
        0 => ( // TSLA/USDC
            &accounts.vault_tsla,
            &accounts.vault_usdc,
            &accounts.tsla_mint,
            &accounts.usdc_mint,
            &accounts.jupiter_pool_0,
            &accounts.jupiter_vault_0_tsla,
            &accounts.jupiter_vault_0_usdc,
        ),
        // ... cases for other pairs
        _ => return Err(ErrorCode::InvalidPairId.into()),
    };

    // Build Jupiter swap instruction
    let discriminator: [u8; 8] = [0xf8, 0xc6, 0x9e, 0x91, 0xe1, 0x75, 0x87, 0xc8];
    let min_amount_out = (amount_in * 99) / 100; // 1% slippage

    let mut data = Vec::with_capacity(24);
    data.extend_from_slice(&discriminator);
    data.extend_from_slice(&amount_in.to_le_bytes());
    data.extend_from_slice(&min_amount_out.to_le_bytes());

    let accounts_meta = vec![
        AccountMeta::new(accounts.pool.key(), true),
        AccountMeta::new(jupiter_pool.key(), false),
        AccountMeta::new_readonly(sell_mint.key(), false),
        AccountMeta::new_readonly(buy_mint.key(), false),
        AccountMeta::new(sell_vault.key(), false),
        AccountMeta::new(buy_vault.key(), false),
        AccountMeta::new(jupiter_sell_vault.key(), false),
        AccountMeta::new(jupiter_buy_vault.key(), false),
        AccountMeta::new_readonly(accounts.token_program.key(), false),
    ];

    let swap_ix = Instruction {
        program_id: accounts.jupiter_program.key(),
        accounts: accounts_meta,
        data,
    };

    // Execute CPI
    let pool_seeds = &[POOL_SEED, &[accounts.pool.bump]];
    invoke_signed(
        &swap_ix,
        &[
            accounts.pool.to_account_info(),
            jupiter_pool.to_account_info(),
            sell_mint.to_account_info(),
            buy_mint.to_account_info(),
            sell_vault.to_account_info(),
            buy_vault.to_account_info(),
            jupiter_sell_vault.to_account_info(),
            jupiter_buy_vault.to_account_info(),
            accounts.token_program.to_account_info(),
        ],
        &[&pool_seeds[..]],
    )?;

    msg!("Jupiter swap executed: {} {} → {} {}", amount_in, sell_asset, min_amount_out, buy_asset);

    // Return actual amount out
    // In production, parse from Jupiter return data or events
    Ok(min_amount_out)
}
```

#### 4. Client-Side Usage with ALT

```typescript
// execute-batch.ts
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
} from '@solana/web3.js';

async function executeBatch(
  connection: Connection,
  program: Program,
  operator: Keypair,
  lookupTableAddress: PublicKey,
) {
  // Fetch the lookup table
  const lookupTableAccount = await connection
    .getAddressLookupTable(lookupTableAddress)
    .then((res) => res.value);

  if (!lookupTableAccount) {
    throw new Error('Lookup table not found');
  }

  // Build execute_batch instruction
  const ix = await program.methods
    .executeBatch(computationOffset)
    .accounts({
      operator: operator.publicKey,
      pool: poolPda,
      batchAccumulator: batchAccumulatorPda,
      batchLog: batchLogPda,
      // All other accounts...
      // These will be referenced via ALT
    })
    .instruction();

  // Create versioned transaction with ALT
  const message = new TransactionMessage({
    payerKey: operator.publicKey,
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    instructions: [ix],
  }).compileToV0Message([lookupTableAccount]); // Pass ALT here

  const versionedTx = new VersionedTransaction(message);
  versionedTx.sign([operator]);

  // Send transaction
  const signature = await connection.sendTransaction(versionedTx);
  await connection.confirmTransaction(signature);

  console.log('Batch executed with ALT:', signature);
}
```

### Pros & Cons

**Pros:**
- ✅ Everything in one transaction/callback
- ✅ Auto-trigger works perfectly
- ✅ Real Jupiter swaps with actual liquidity
- ✅ No off-chain coordination needed
- ✅ Lower latency (single transaction)
- ✅ Users can settle immediately after batch executes

**Cons:**
- ❌ Complex initial setup (create and populate ALT)
- ❌ All swap accounts loaded even if unused
- ❌ Higher compute units (more accounts = more CU)
- ❌ ALT maintenance (must update if adding pairs)
- ❌ V0 transactions only (not all wallets support yet)
- ❌ Callback must handle all pairs (can't skip/retry)

### Cost Analysis

- **Setup:** One-time ALT creation (~0.01 SOL)
- **Per Batch:** Single execute_batch transaction
- **Gas Cost:** Higher compute units (more accounts), but single tx
- **Latency:** ~2-4 seconds (single transaction)

---

## Comparison Summary

| Aspect | Current (Simulation) | Alt 1: Off-Chain | Alt 2: ALT |
|--------|---------------------|------------------|------------|
| **Real Swaps** | ❌ Simulated | ✅ Real | ✅ Real |
| **Auto-Trigger** | ✅ Yes | ❌ No | ✅ Yes |
| **Latency** | Fast (1 tx) | Slow (2-8 txs) | Fast (1 tx) |
| **Infrastructure** | Simple | Off-chain service | Setup ALT |
| **Complexity** | Low | High | Medium |
| **Immediate Settlement** | ✅ Yes | ❌ Delayed | ✅ Yes |
| **Gas Cost** | Low | High (multiple txs) | Medium (high CU) |
| **Best For** | MVP/Testing | Production with flexibility | Production automation |

---

## Recommendation

**For MVP Launch:**
- Use **Current Simulation** approach
- Simple, works well for testing
- Manually rebalance with `test_swap` when needed

**For Production (Choose based on priorities):**

**If "Fully Automatic" is critical:**
- Use **Alternative 2 (ALT)**
- One-time setup complexity, then fully automatic
- Best user experience (immediate settlement)

**If "Flexibility & Monitoring" is critical:**
- Use **Alternative 1 (Off-Chain)**
- More control over swap execution
- Can retry, batch, or optimize swaps
- Better for complex liquidity management

---

## Migration Path

1. **Phase 1 (Current):** Simulation
2. **Phase 2:** Setup ALT and deploy Alt 2 (automatic swaps)
3. **Phase 3 (Optional):** Add off-chain monitoring for rebalancing edge cases

This gives you the best of both worlds: automatic execution with optional advanced management.
