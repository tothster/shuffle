# Arcis Reference

Complete syntax reference for Arcis MPC circuits.

## Types

### Supported Types
| Type | Description |
|------|-------------|
| `u8`, `u16`, `u32`, `u64`, `u128` | Unsigned integers |
| `i8`, `i16`, `i32`, `i64`, `i128` | Signed integers |
| `f32`, `f64` | Fixed-point floats (52 fractional bits, range `[-2^75, 2^75)`) |
| `bool` | Boolean |
| `[T; N]` | Fixed-size arrays |
| `(T1, T2, ...)` | Tuples |
| User structs | `#[derive(Copy, Clone)]` required |

### Encryption Types
```rust
// Shared: client + MXE can decrypt
fn process(input: Enc<Shared, u64>) -> Enc<Shared, u64>

// MXE-owned: only MXE can decrypt
fn process_state(state: Enc<Mxe, GameState>) -> Enc<Mxe, GameState>

// EncData: raw ciphertext without metadata (smaller payload)
fn verify(a: Enc<Shared, T>, observer: Shared) -> EncData<bool> {
    observer.from_arcis(result).data
}
```

### Special Types
| Type | Description |
|------|-------------|
| `ArcisX25519Pubkey` | X25519 public key |
| `SolanaPublicKey` | Solana public key (32 bytes) |
| `Pack<T>` | Bit-packed data for efficient storage |
| `EncData<T>` | Encrypted data without cipher metadata |
| `BaseField` | Curve25519 field element |

## Operations

### Supported Operations
```rust
// Arithmetic
let sum = a + b;
let diff = a - b;
let prod = a * b;
let quot = a / b;
let rem = a % b;

// Comparisons
let eq = a == b;
let lt = a < b;
let gt = a > b;

// Bitwise (right shift only)
let shifted = a >> 4;  // const shift amount required

// Casting
let big = small as u64;
```

### Control Flow
```rust
// if/else - BOTH branches always execute when condition is secret
let result = if condition { a } else { b };

// for loops - FIXED iteration count required
for i in 0..10 {
    process(arr[i]);
}
```

> **NOT SUPPORTED**: `while`, `loop`, `match`, `break`, `continue`, early `return`

### Arrays
```rust
let arr: [u8; 10] = [0; 10];

// Constant index: O(1)
let x = arr[5];

// Secret index: O(n)
let y = arr[secret_idx];

// Methods
arr.swap(0, 1);
arr.reverse();
arr.fill(42);
arr.sort();  // O(n·log²(n)·bit_size)
```

### Iterators
```rust
arr.iter().map(|x| *x * 2).sum()
arr.iter().enumerate().fold(0, |acc, (i, x)| acc + *x)
```

> **NOT SUPPORTED**: `.filter()`

## Randomness (ArcisRNG)

```rust
// Random boolean
let coin = ArcisRNG::bool();

// Random integer with bit width
let num = ArcisRNG::gen_integer_from_width(64);  // 0 to 2^64-1

// Uniform random value
let bytes = ArcisRNG::gen_uniform::<[u8; 32]>();

// Random in range (rejection sampling)
let (roll, success) = ArcisRNG::gen_integer_in_range(1, 6, 24);

// Shuffle array
ArcisRNG::shuffle(&mut cards);
```

## Cryptographic Operations

### SHA3 Hashing
```rust
let hash = SHA3_256::new().digest(&data).reveal();
let hash512 = SHA3_512::new().digest(&data).reveal();
```

### Ed25519 Signatures
```rust
// Verify signature
let vk = verifying_key.unpack();
let sig = ArcisEd25519Signature::from_bytes(signature);
let valid = vk.verify(&message, &sig).reveal();

// Generate keypair
let sk = SecretKey::new_rand();
let vk = VerifyingKey::from_secret_key(&sk);

// MXE cluster signing
let sig = MXESigningKey::sign(&message).reveal();
```

### Public Key Operations
```rust
let pk = ArcisX25519Pubkey::from_base58(b"...");
let pk = ArcisX25519Pubkey::from_uint8(&bytes);
let equal = (pk1 == pk2).reveal();
```

## Data Packing

Reduce onchain storage with bit-packing:

```rust
// Pack for efficient storage
let packed = Pack::new(data);

// Unpack to use
let data: [u8; 64] = packed.unpack();
```

## Debugging

```rust
// Print debugging (development only)
println!("value = {}", x);

// Debug assertions (development only)
debug_assert!(x > 0, "x must be positive");
```

## External References

- [Arcis Types](https://docs.arcium.com/developers/arcis/types)
- [Arcis Operations](https://docs.arcium.com/developers/arcis/operations)
- [Arcis Primitives](https://docs.arcium.com/developers/arcis/primitives)
- [Thinking in MPC](https://docs.arcium.com/developers/arcis/mental-model)
