# Build & Installation Troubleshooting

Solutions for common installation and build issues.

## Installation Issues

### Arcium CLI Installer PATH Issues

**Problem**: Installer script can't find Rust/Solana even when installed.

**Cause**: Installer runs in fresh shell without PATH from current session.

**Solution**: Download binaries directly:

```bash
# Get latest version
curl -sSfL "https://bin.arcium.com/download/versions/latest-tooling"

# Download arcium CLI (macOS ARM64)
curl -sSfL "https://bin.arcium.com/download/arcium_aarch64_macos_0.6.3" \
  -o ~/.cargo/bin/arcium
chmod +x ~/.cargo/bin/arcium

# Download arcup (version manager)
curl -sSfL "https://bin.arcium.com/download/arcup_aarch64_macos_0.6.3" \
  -o ~/.cargo/bin/arcup
chmod +x ~/.cargo/bin/arcup
```

For Linux x86_64, replace `aarch64_macos` with `x86_64_linux`.

### Solana CLI Version Compatibility

> [!CAUTION]
> Arcium 0.6.x requires Solana CLI 2.3.0, **NOT 3.x**.

**Problem**: Tests fail or MPC nodes don't process computations.

**Solution**:
```bash
# Install Solana 2.3.0 specifically
sh -c "$(curl -sSfL https://release.anza.xyz/v2.3.0/install)"

# Verify
solana --version  # Should show: solana-cli 2.3.0
```

### Docker Images for Apple Silicon

**Problem**: `no matching manifest for linux/arm64/v8`.

**Cause**: Arcium images only built for AMD64.

**Solution**: Use Rosetta emulation:

```bash
# Enable Rosetta in OrbStack/Docker Desktop

# Pull with explicit platform
docker pull --platform linux/amd64 arcium/arx-node:latest
docker pull --platform linux/amd64 arcium/trusted-dealer:latest
```

### `arcup install` Panics

**Problem**: `thread 'main' panicked at arcup/src/config.rs`.

**Cause**: Bug when no configuration exists.

**Solution**: Skip arcup, download binary directly (see above).

---

## Build Errors

### Stack Offset Exceeded

**Error**:
```
Error: Stack offset of 4104 exceeded max offset of 4096 by 8 bytes
```

**Cause**: Account struct too large for Solana stack.

**Solution**: Wrap accounts in `Box<>`:

```rust
#[derive(Accounts)]
pub struct Initialize<'info> {
    // Move large accounts to heap
    pub pool: Box<Account<'info, Pool>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub vault_usdc: Box<Account<'info, TokenAccount>>,
}
```

### `ts-mocha` Not Found

**Error**: `error Command "ts-mocha" not found.`

**Solution**:
```bash
cd contract
yarn install
```

### Validator Bind Address Panic

**Error**: `UnspecifiedIpAddr(0.0.0.0)`

**Cause**: Solana 3.x requires explicit bind address.

**Solution**: Add to `Anchor.toml`:

```toml
[test.validator]
bind_address = "127.0.0.1"
url = "http://127.0.0.1:8899"
ledger = ".anchor/test-ledger"
```

### `arcium init` Wrong Location

**Problem**: Creates project in new subdirectory instead of current directory.

**Solution**:
1. Create project in temp location: `arcium init temp-project`
2. Copy files to your desired location
3. Update `Anchor.toml` and `Cargo.toml` with correct names

---

## Environment Setup

### Complete Working Installation

```bash
# 1. Rust (if needed)
source ~/.cargo/env
rustup toolchain install stable

# 2. Solana CLI 2.3.0 (NOT 3.x!)
sh -c "$(curl -sSfL https://release.anza.xyz/v2.3.0/install)"

# 3. Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.32.1
avm use 0.32.1

# 4. Arcium (direct download for macOS ARM64)
curl -sSfL "https://bin.arcium.com/download/arcium_aarch64_macos_0.6.3" \
  -o ~/.cargo/bin/arcium
chmod +x ~/.cargo/bin/arcium

# 5. Add to PATH (add to ~/.bashrc and ~/.zshrc)
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

# 6. Verify
source ~/.bashrc
rustc --version && solana --version && anchor --version && arcium --version
```

### PATH Configuration

Add to `~/.bashrc` and `~/.zshrc`:

```bash
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
```

Source before running commands:
```bash
source ~/.bashrc && arcium build
```

---

## Quick Diagnosis Commands

```bash
# Check all tool versions
rustc --version
solana --version    # Must be 2.3.x, NOT 3.x
anchor --version
arcium --version

# Check SDK version matches yarn.lock
cat node_modules/@arcium-hq/client/package.json | grep version

# Check Docker images
docker images | grep arcium

# Check port availability
lsof -i :8899  # Solana RPC
lsof -i :9900  # Faucet

# Test validator connection
curl -s http://127.0.0.1:8899 -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```
