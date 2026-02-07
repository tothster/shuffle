# Debugging Guide

Runtime debugging patterns for Arcium applications.

## Test Debugging Patterns

### Selective Testing with `.only()`

Focus on specific tests during development:

```typescript
// Run ONLY this test (plus required setup tests)
it.only("My new feature works correctly", async () => {
  // Test code
});
```

> **Note**: Remove `.only()` before committing—it skips other tests in CI.

### Test Dependencies

Tests must run in order—initialization first:

```
1. Initialize computation definitions (each circuit needs init)
2. Create user accounts
3. Initialize encrypted state
   ↓
4. Feature tests can now run
```

### Idempotent Tests

Check if accounts exist before creating to avoid `AccountAlreadyInUse`:

```typescript
const existingAccount = await provider.connection.getAccountInfo(accountPDA);
if (existingAccount) {
  console.log("Account exists, skipping creation");
  return;
}
// Otherwise create the account
```

### Retry Logic for Blockhash Issues

Handle intermittent timing errors:

```typescript
let retries = 3;
while (retries > 0) {
  try {
    await createAccount();
    break;
  } catch (e) {
    if (e.message?.includes("Blockhash not found") && retries > 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      retries--;
    } else {
      throw e;
    }
  }
}
```

---

## MPC Callback Issues

### "Unknown action 'undefined'" Error

**Symptom**: MPC computation queues but callback fails with undefined action.

**Causes**:
1. Callback not finalized after `init_*_comp_def`
2. Circuit not properly built/uploaded
3. Naming mismatch between circuit and callback

**Solution**:

1. **Finalize computation definition** after initialization:

```typescript
// After init_my_circuit_comp_def() succeeds:
const finalizeTx = await buildFinalizeCompDefTx(
  provider as anchor.AnchorProvider,
  Buffer.from(getCompDefAccOffset("my_circuit")).readUInt32LE(),
  program.programId
);

const latestBlockhash = await provider.connection.getLatestBlockhash();
finalizeTx.recentBlockhash = latestBlockhash.blockhash;
finalizeTx.sign(owner);
await provider.sendAndConfirm(finalizeTx);
```

2. **Verify circuit is built**: Check `build/<circuit_name>.arcis` exists after `arcium build`

3. **Match naming convention**: Callback must be named `<circuit_name>_callback` for both function and struct

### Callback Naming Convention

```rust
// Circuit name: "my_circuit"
const COMP_DEF_OFFSET_MY_CIRCUIT: u32 = comp_def_offset("my_circuit");

// Callback function MUST match: my_circuit_callback
#[arcium_callback(encrypted_ix = "my_circuit")]
pub fn my_circuit_callback(
    ctx: Context<MyCircuitCallback>,  // Struct also matches
    output: SignedComputationOutputs<MyCircuitOutput>,
) -> Result<()> { ... }
```

---

## MPC Timeout Debugging

### Rosetta Emulation Slowness (Apple Silicon)

MPC nodes run under x86 emulation on M1/M2/M3 Macs, causing 3-10x slowdown.

**Symptoms**:
- `TransactionExpiredTimeoutError: Transaction was not confirmed in 30.00 seconds`
- Computation queues but never finalizes

**Solutions**:
1. Skip full MPC tests on Apple Silicon; test Anchor instructions only
2. Run on native x86 hardware for full MPC testing
3. Increase timeout (may still be too slow)

### Check Node Logs

```bash
# View MPC node logs
ls artifacts/arx_node_logs/
cat artifacts/arx_node_logs/*.log | tail -100

# Check for errors
grep -i error artifacts/arx_node_logs/*.log
```

### Verify Computation Status

```typescript
// Wait with extended timeout
const finalizeSig = await awaitComputationFinalization(
  provider as anchor.AnchorProvider,
  computationOffset,
  program.programId,
  "confirmed"
);
```

---

## Common Runtime Errors

### `AccountNotEnoughKeys`

**Cause**: SDK version mismatch between installed and yarn.lock.

**Diagnosis**:
```bash
# Check installed version
cat node_modules/@arcium-hq/client/package.json | grep '"version"'

# Check yarn.lock version
grep -A1 '"@arcium-hq/client@' yarn.lock
```

**Solution**:
```bash
rm -rf node_modules && yarn install
```

### `AccountAlreadyInUse`

**Cause**: Tests not idempotent—trying to create existing accounts.

**Solution**: Check account existence before creating (see idempotent tests above).

### `BlockhashNotFound`

**Cause**: Transactions sent faster than validator can process.

**Solution**:
1. Add delays between rapid transactions
2. Add retry logic with backoff
3. Use fresh blockhash for each transaction

### Stack Overflow in Anchor Build

**Symptom**:
```
Error: Function ...try_accounts... Stack offset of 4104 exceeded max offset of 4096
```

**Cause**: Large account structs exceed Solana's stack limit.

**Solution**: Wrap large accounts in `Box<>`:

```rust
// Before (stack overflow)
pub pool: Account<'info, Pool>,
pub usdc_mint: Account<'info, Mint>,

// After (heap allocated)
pub pool: Box<Account<'info, Pool>>,
pub usdc_mint: Box<Account<'info, Mint>>,
```

---

## Debug Commands Quick Reference

```bash
# Clean test state
rm -rf .anchor/test-ledger && arcium test

# Check validator logs
cat .anchor/test-ledger/validator.log | tail -50

# Check MPC node logs
cat artifacts/arx_node_logs/*.log | tail -100

# Verify SDK version
cat node_modules/@arcium-hq/client/package.json | grep version

# Check Docker containers
docker ps -a | grep arcium
```

---

## Print Debugging in Circuits

```rust
#[instruction]
fn debug_example(a: u32, b: u32) -> u32 {
    println!("Inputs: a = {}, b = {}", a, b);
    
    let result = a + b;
    println!("Result: {}", result);
    
    result
}
```

> **Note**: Print output appears in MPC node logs, not test output.
