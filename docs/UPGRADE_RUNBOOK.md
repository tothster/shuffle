# Shuffle Devnet Upgrade Runbook

This runbook covers:
- callback diagnostics patch deployment
- `encrypted-ixs` rebuild/redeploy workflow
- when SDK changes are required

## Scope

Program:
- `D5hXtvqYeBHM4f8DqJuYyioPNDsQS6jhSRqj9DmFFvCH` (devnet)

Current behavior:
- `add_balance` queue succeeds
- callback may fail with `AbortedComputation (6018)`

## 1) Callback Diagnostics Upgrade (No New Program ID)

This upgrade is in-place. Do not deploy a new program ID.

1. Build:
```bash
cd contract
arcium build
```

2. Upgrade existing devnet program:
```bash
anchor upgrade target/deploy/shuffle_protocol.so \
  --program-id D5hXtvqYeBHM4f8DqJuYyioPNDsQS6jhSRqj9DmFFvCH \
  --provider.cluster "https://devnet.helius-rpc.com/?api-key=<API_KEY>" \
  --provider.wallet ~/.config/solana/id.json
```

3. Validate with a `shuffle shield usdc 50` attempt and inspect logs:
- expected new logs include:
  - `add_balance_callback verify_output failed: ...`
  - context account keys

SDK impact:
- none (IDL/instruction interface unchanged)

## 2) encrypted-ixs Rebuild/Redeploy Workflow

### Important constraint

Computation definitions are PDA-derived by circuit name/offset. Existing finalized
comp-def accounts are not expected to be mutable in place.

That means a circuit artifact refresh has two paths:

### Path A: No SDK change (same comp-def name/offset)

Use this only if you are *not* rotating comp-def names and do not need new comp-def
accounts.

- upgrade program in place
- keep current comp-def offsets (`add_balance`, `sub_balance`, etc.)

### Path B: New comp-def version (recommended for true circuit rotation)

Use this if you need a fresh off-chain circuit source/hash and a clean comp-def.

1. Introduce versioned circuit identifiers in program, e.g.:
- `add_balance_v2`
- `sub_balance_v2`

2. Update:
- `comp_def_offset("...")` constants
- `#[queue_computation_accounts(\"...\")]`
- `#[callback_accounts(\"...\")]`
- callback attributes if needed

3. Add new init instructions (`init_add_balance_v2_comp_def`, etc.).

4. Upgrade program.

5. Initialize/finalize new comp-def accounts on devnet.

6. Update SDK comp-def name mapping to use v2 names.

SDK impact:
- required for Path B (client derives comp-def PDAs by name/offset)

## 3) Circuit Gateway Availability Check

Use:
```bash
bash contract/scripts/check-circuit-gateways.sh
```

This checks all pinned circuit CIDs against:
- `gateway.pinata.cloud`
- `ipfs.io`
- `dweb.link/ipfs/<cid>`

## 4) Deployment Decision Matrix

- Callback diagnostics only: program upgrade only, no SDK update.
- Full circuit rotation with new comp-def accounts: program + SDK update.
- New program ID: not required for either path above.
