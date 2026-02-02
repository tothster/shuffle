# Testing Guide

Testing and debugging Arcium applications.

## Unit Testing

### What Can Be Unit Tested
- Helper functions (non-`#[instruction]`)
- `#[arcis_circuit]` builtin functions
- Pure computation logic

### What Cannot Be Unit Tested
- `#[instruction]` functions (require MPC runtime)

### Testing Strategy
Extract testable logic into helper functions:

```rust
#[encrypted]
mod circuits {
    use arcis::*;

    // ✓ Testable: regular function
    pub fn calculate_fee(amount: u64, rate: u64) -> u64 {
        amount * rate / 10000
    }

    // ✓ Testable: builtin circuit
    #[arcis_circuit = "min"]
    pub fn min(a: u128, b: u128) -> u128 {}

    // ✗ NOT directly testable: requires MPC
    #[instruction]
    fn transfer_with_fee(amount: u64, rate: u64) -> u64 {
        let fee = calculate_fee(amount, rate);
        amount - fee
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fee_calculation() {
        assert_eq!(circuits::calculate_fee(10000, 250), 250);
        assert_eq!(circuits::calculate_fee(5000, 100), 50);
    }

    #[test]
    fn test_builtin_circuit() {
        assert_eq!(circuits::min(10, 20), 10);
        assert_eq!(circuits::min(1, 0), 0);
    }
}
```

---

## Integration Testing (TypeScript)

Full end-to-end testing using `@arcium-hq/client`.

### Test Setup

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  RescueCipher,
  deserializeLE,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  x25519,
  getComputationAccAddress,
  getMXEPublicKey,
  getClusterAccAddress,
} from "@arcium-hq/client";

describe("My MXE", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.MyMxe;
  const provider = anchor.getProvider();
  const arciumEnv = getArciumEnv();
});
```

### Key Exchange and Encryption

```typescript
// 1. Get MXE public key
const mxePublicKey = await getMXEPublicKey(
  provider as anchor.AnchorProvider,
  program.programId
);

// 2. Generate client keypair
const privateKey = x25519.utils.randomSecretKey();
const publicKey = x25519.getPublicKey(privateKey);

// 3. Create shared secret
const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);

// 4. Create cipher
const cipher = new RescueCipher(sharedSecret);

// 5. Encrypt values
const nonce = randomBytes(16);
const plaintext = [BigInt(42)];
const ciphertext = cipher.encrypt(plaintext, nonce);
```

### Initialize Computation Definition

```typescript
it("initializes computation definition", async () => {
  const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);
  
  const sig = await program.methods
    .initFlipCompDef()
    .accounts({
      compDefAccount: getCompDefAccAddress(
        program.programId,
        Buffer.from(getCompDefAccOffset("flip")).readUInt32LE()
      ),
      payer: owner.publicKey,
      mxeAccount: getMXEAccAddress(program.programId),
    })
    .signers([owner])
    .rpc({ commitment: "confirmed" });
    
  console.log("Init comp def tx:", sig);
});
```

### Queue and Await Computation

```typescript
it("executes encrypted computation", async () => {
  // Setup event listener
  const eventPromise = awaitEvent("flipEvent");
  
  // Generate computation offset
  const computationOffset = new anchor.BN(randomBytes(8), "hex");
  
  // Queue computation
  const queueSig = await program.methods
    .flip(
      computationOffset,
      Array.from(ciphertext[0]),
      Array.from(publicKey),
      new anchor.BN(deserializeLE(nonce).toString())
    )
    .accountsPartial({
      computationAccount: getComputationAccAddress(
        arciumEnv.arciumClusterOffset,
        computationOffset
      ),
      clusterAccount: getClusterAccAddress(arciumEnv.arciumClusterOffset),
      mxeAccount: getMXEAccAddress(program.programId),
      mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
      executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
      compDefAccount: getCompDefAccAddress(
        program.programId,
        Buffer.from(getCompDefAccOffset("flip")).readUInt32LE()
      ),
    })
    .rpc({ skipPreflight: true, commitment: "confirmed" });
    
  console.log("Queue sig:", queueSig);
  
  // Wait for computation to finalize
  const finalizeSig = await awaitComputationFinalization(
    provider as anchor.AnchorProvider,
    computationOffset,
    program.programId,
    "confirmed"
  );
  console.log("Finalize sig:", finalizeSig);
  
  // Get result from event
  const event = await eventPromise;
  console.log("Result:", event.result);
});
```

### Event Listener Helper

```typescript
type Event = anchor.IdlEvents<(typeof program)["idl"]>;

const awaitEvent = async <E extends keyof Event>(
  eventName: E
): Promise<Event[E]> => {
  let listenerId: number;
  const event = await new Promise<Event[E]>((res) => {
    listenerId = program.addEventListener(eventName, (event) => {
      res(event);
    });
  });
  await program.removeEventListener(listenerId);
  return event;
};
```

### Decrypting Results

```typescript
// For Enc<Shared, T> outputs, decrypt on client:
const decrypted = cipher.decrypt([event.ciphertext], event.nonce)[0];
expect(decrypted).to.equal(expectedValue);
```

---

## Debugging

### Print Debugging

```rust
#[instruction]
fn debug_example(a: u32, b: u32) -> u32 {
    println!("Inputs: a = {}, b = {}", a, b);
    
    let result = a + b;
    println!("Result: {}", result);
    
    // Also available: print!, eprint!, eprintln!
    eprintln!("Debug: computation complete");
    
    result
}
```

> **Note**: Print macros are for development only. Output appears during circuit execution on ARX nodes.

### Debug Assertions

```rust
#[instruction]
fn with_assertions(x: u32, y: u32) -> u32 {
    debug_assert!(x > 0, "x must be positive");
    debug_assert_eq!(x, x, "sanity check");
    debug_assert_ne!(x, y, "x and y should differ");
    
    x + y
}
```

> **Warning**: `debug_assert` macros are for development only. They do not enforce constraints in production.

### Common Debugging Patterns

```rust
// Trace loop iterations
for i in 0..10 {
    println!("Iteration {}: value = {}", i, arr[i]);
}

// Check intermediate values
let step1 = compute_step1(input);
println!("After step1: {}", step1);

let step2 = compute_step2(step1);
println!("After step2: {}", step2);
```

---

## Running Tests

```bash
# Install dependencies
yarn install  # or npm install

# Build program and circuits
arcium build

# Run tests against local cluster
arcium test

# Run tests against devnet
arcium test --cluster devnet
```

---

## External References
- [Best Practices](https://docs.arcium.com/developers/arcis/best-practices)
- [JavaScript Client Library](https://docs.arcium.com/developers/js-client-library)
- [TypeScript SDK API](https://ts.arcium.com/api)
