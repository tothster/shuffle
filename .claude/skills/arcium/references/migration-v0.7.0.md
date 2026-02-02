# Arcium v0.6.3 to v0.7.0 Migration Guide

## Overview

Version 0.7.0 introduces Address Lookup Table (LUT) support and removes the deprecated `callback_url` parameter from `queue_computation()`.

## Breaking Changes

### 1. Removed callback_url Parameter

**Old (v0.6.3):**
```rust
queue_computation(
    ctx.accounts,
    computation_offset,
    args,
    None,  // ← callback_url removed in v0.7.0
    vec![MyCallback::callback_ix(...)],
    1,
    0,
)?;
```

**New (v0.7.0):**
```rust
queue_computation(
    ctx.accounts,
    computation_offset,
    args,
    vec![MyCallback::callback_ix(...)],
    1,
    0,
)?;
```

Simply remove the 4th parameter (callback_url) from all `queue_computation()` calls.

## Required Changes

### 2. Add LUT Accounts to InitCompDef Structs

All `InitCompDef` structs must include two new accounts for Address Lookup Table support.

**Old (v0.6.3):**
```rust
#[init_computation_definition_accounts("my_circuit", payer)]
#[derive(Accounts)]
pub struct InitMyCircuitCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}
```

**New (v0.7.0):**
```rust
#[init_computation_definition_accounts("my_circuit", payer)]
#[derive(Accounts)]
pub struct InitMyCircuitCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: address_lookup_table, checked by arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program is the Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}
```

Add these two accounts **before** `arcium_program`:
1. `address_lookup_table` - Uses `derive_mxe_lut_pda!` macro
2. `lut_program` - Points to `LUT_PROGRAM_ID`

### 3. Update TypeScript Initialization Code

TypeScript code that initializes computation definitions must now fetch the MXE account and pass the LUT address.

**Old (v0.6.3):**
```typescript
import {
  getMXEAccAddress,
  getCompDefAccAddress,
  // ...
} from "@arcium-hq/client";

await program.methods
  .initMyCircuitCompDef()
  .accounts({
    compDefAccount: compDefPDA,
    payer: owner.publicKey,
    mxeAccount: getMXEAccAddress(program.programId),
  })
  .signers([owner])
  .rpc();
```

**New (v0.7.0):**
```typescript
import {
  getMXEAccAddress,
  getCompDefAccAddress,
  getLookupTableAddress,
  getArciumProgram,
  // ...
} from "@arcium-hq/client";

// Fetch MXE account to get LUT offset
const arciumProgram = getArciumProgram(provider);
const mxeAccount = getMXEAccAddress(program.programId);
const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
const lutAddress = getLookupTableAddress(
  program.programId,
  mxeAcc.lutOffsetSlot
);

await program.methods
  .initMyCircuitCompDef()
  .accounts({
    compDefAccount: compDefPDA,
    payer: owner.publicKey,
    mxeAccount,
    addressLookupTable: lutAddress,  // ← New required parameter
  })
  .signers([owner])
  .rpc();
```

### 4. Update Dependencies

**Rust (Cargo.toml):**
```toml
[dependencies]
arcis = "0.7.0"
arcium-client = { default-features = false, version = "=0.7.0" }
arcium-macros = "=0.7.0"
arcium-anchor = "=0.7.0"
```

**TypeScript (package.json):**
```json
{
  "dependencies": {
    "@arcium-hq/client": "0.7.0"
  }
}
```

## New Features

### Tree-Shaking Support

Both `@arcium-hq/client` and `@arcium-hq/reader` now include `"sideEffects": false` for automatic bundle size optimization by modern bundlers.

### Address Lookup Table Benefits

LUT support allows additional space in callback transactions, enabling more complex callbacks with more accounts.

## Migration Steps

1. **Update dependencies** in all Cargo.toml and package.json files
2. **Add LUT accounts** to all `InitCompDef` structs in Rust
3. **Remove callback_url** parameter from all `queue_computation()` calls
4. **Update TypeScript** initialization code to fetch and pass LUT address
5. **Test** with `arcium build && cargo check --all && arcium test`

## Complete Example

See the v0.6.6 examples repository for working v0.7.0 code:
- Rust: [coinflip/programs/coinflip/src/lib.rs](https://github.com/arcium-hq/examples/tree/v0.6.6/coinflip)
- TypeScript: [coinflip/tests/coinflip.ts](https://github.com/arcium-hq/examples/tree/v0.6.6/coinflip)

## Troubleshooting

### Build Errors

**Error:** `Could not read compiled confidential ix at path build/my_circuit.arcis`
- **Solution:** Run `arcium build` before `cargo check`

**Error:** `unresolved imports` or `custom attribute panicked`
- **Solution:** Ensure all LUT accounts are added to InitCompDef structs

### Runtime Errors

**Error:** Account validation failed during init comp def
- **Solution:** Verify `addressLookupTable` is passed in TypeScript accounts object

## Reference

- [Official Migration Guide](https://docs.arcium.com/developers/migration/migration-v0.6.3-to-v0.7.0)
- [Arcium SDK Docs](https://ts.arcium.com/api)
- [Examples Repository v0.6.6](https://github.com/arcium-hq/examples/tree/v0.6.6)
