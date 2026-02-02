# Solana Integration

Integrating Arcis circuits with Solana programs using Anchor.

## Program Structure

### Solana Program (Anchor)

```rust
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

// Computation definition offset for the encrypted instruction
const COMP_DEF_OFFSET_FLIP: u32 = comp_def_offset("flip");

declare_id!("YOUR_PROGRAM_ID_HERE");

#[arcium_program]  // Replaces #[program]
pub mod my_mxe {
    use super::*;

    // 1. Initialize computation definition (call once after deploy)
    pub fn init_flip_comp_def(ctx: Context<InitFlipCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    // 2. Queue computation (call to invoke encrypted instruction)
    pub fn flip(
        ctx: Context<Flip>,
        computation_offset: u64,
        ciphertext_0: [u8; 32],
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce)
            .encrypted_bool(ciphertext_0)
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![FlipCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[]
            )?],
            1,
            0,  // cu_price_micro: priority fee
        )?;
        Ok(())
    }

    // 3. Handle callback (called by MPC cluster with result)
    #[arcium_callback(encrypted_ix = "flip")]
    pub fn flip_callback(
        ctx: Context<FlipCallback>,
        output: SignedComputationOutputs<FlipOutput>,
    ) -> Result<()> {
        let result = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account
        ) {
            Ok(FlipOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("Error: {}", e);
                return Err(ErrorCode::AbortedComputation.into())
            },
        };

        emit!(FlipEvent { result });
        Ok(())
    }
}
```

## Three-Instruction Pattern

Every encrypted instruction requires three Solana instructions:

| Instruction | Purpose | When Called |
|-------------|---------|-------------|
| `init_*_comp_def` | Register computation definition | Once after deploy |
| `<instruction>` | Queue computation with encrypted args | Each invocation |
| `<instruction>_callback` | Receive and process result | By MPC cluster |

## ArgBuilder

Build encrypted arguments for `queue_computation`:

```rust
let args = ArgBuilder::new()
    .x25519_pubkey(pub_key)           // Client's X25519 public key
    .plaintext_u128(nonce)            // Encryption nonce
    .encrypted_u8(ciphertext)         // Encrypted u8
    .encrypted_u64(ciphertext)        // Encrypted u64
    .encrypted_bool(ciphertext)       // Encrypted bool
    .encrypted_account(account_addr, ciphertexts) // Account with encrypted fields
    .build();
```

## Account Structures

```rust
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct Flip<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    
    /// CHECK: Arcium computation account
    #[account(mut)]
    pub computation_account: UncheckedAccount<'info>,
    
    /// CHECK: MXE account
    pub mxe_account: UncheckedAccount<'info>,
    
    /// CHECK: Cluster account
    pub cluster_account: UncheckedAccount<'info>,
    
    /// CHECK: Mempool account
    #[account(mut)]
    pub mempool_account: UncheckedAccount<'info>,
    
    /// CHECK: Executing pool
    #[account(mut)]
    pub executing_pool: UncheckedAccount<'info>,
    
    /// CHECK: Computation definition
    pub comp_def_account: UncheckedAccount<'info>,
    
    // ... other accounts
}
```

## Helper Functions

```rust
use arcium_anchor::prelude::*;

// Get account addresses
let mxe_acc = getMXEAccAddress(program_id);
let cluster_acc = getClusterAccAddress(cluster_offset);
let mempool_acc = getMempoolAccAddress(cluster_offset);
let comp_def_acc = getCompDefAccAddress(program_id, offset);
let computation_acc = getComputationAccAddress(cluster_offset, comp_offset);
let executing_pool = getExecutingPoolAccAddress(cluster_offset);

// Get computation definition offset
let offset = comp_def_offset("instruction_name");
```

## Storing Encrypted State

For encrypted state that persists across calls:

```rust
#[account]
pub struct EncryptedVoteStats {
    pub ciphertexts: [[u8; 32]; 2],  // yes + no as encrypted u64
}

// In instruction
pub fn vote(ctx: Context<Vote>, ...) -> Result<()> {
    // Include encrypted state as argument
    let args = ArgBuilder::new()
        .encrypted_account(
            ctx.accounts.vote_stats.key(),
            &ctx.accounts.vote_stats.ciphertexts
        )
        // ... other args
        .build();
}
```

## External References
- [Program Overview](https://docs.arcium.com/developers/program)
- [Computation Definition Accounts](https://docs.arcium.com/developers/program/computation-def-accs)
- [Callback Accounts](https://docs.arcium.com/developers/program/callback-accs)
- [Callback Type Generation](https://docs.arcium.com/developers/program/callback-type-generation)
