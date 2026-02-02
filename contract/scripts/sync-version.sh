#!/bin/bash
# sync-version.sh - Update Arcium version references in sol-privacy-mvp
# Usage: ./scripts/sync-version.sh <version>
# Example: ./scripts/sync-version.sh 0.6.3

set -eo pipefail

VERSION=${1:-0.6.3}
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Validate version format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: Version must be in format X.Y.Z (e.g., 0.6.3)"
  exit 1
fi

# Check for jq
if ! command -v jq &> /dev/null; then
  echo "Error: jq is required but not installed"
  echo "Install with: brew install jq"
  exit 1
fi

# Check arcium CLI exists (version match not required - CLI from GitHub releases)
ARCIUM_VERSION=$(arcium --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "")
if [ -z "$ARCIUM_VERSION" ]; then
  echo "Error: arcium CLI not found"
  echo "Install from: https://github.com/arcium-hq/arcium-cli/releases"
  exit 1
fi

echo "Current arcium CLI version: $ARCIUM_VERSION"
if [ "$ARCIUM_VERSION" != "$VERSION" ]; then
  echo "Note: CLI version ($ARCIUM_VERSION) differs from target SDK ($VERSION)"
  echo "This is usually fine - CLI is backward compatible with SDK versions."
fi

echo "Syncing sol-privacy-mvp to Arcium version: $VERSION"
echo ""

cd "$REPO_ROOT"

# 1. Update package.json - @arcium-hq/client
echo "Updating package.json..."
if [ -f "package.json" ]; then
  jq ".dependencies[\"@arcium-hq/client\"] = \"$VERSION\"" "package.json" > "package.json.tmp"
  mv "package.json.tmp" "package.json"
  echo "  ✓ package.json updated"
fi

# 2. Update programs/shuffle_protocol/Cargo.toml
echo "Updating programs/shuffle_protocol/Cargo.toml..."
PROGRAM_CARGO="$REPO_ROOT/programs/shuffle_protocol/Cargo.toml"
if [ -f "$PROGRAM_CARGO" ]; then
  # Handle arcium-client with both key orderings
  sed -i '' -E "s/(arcium-client = \{[^}]*version = \")[0-9]+\.[0-9]+\.[0-9]+/\1$VERSION/" "$PROGRAM_CARGO"
  sed -i '' "s/arcium-macros = \"=[^\"]*\"/arcium-macros = \"=$VERSION\"/" "$PROGRAM_CARGO"
  sed -i '' "s/arcium-anchor = \"=[^\"]*\"/arcium-anchor = \"=$VERSION\"/" "$PROGRAM_CARGO"
  echo "  ✓ programs/shuffle_protocol/Cargo.toml updated"
fi

# 3. Update encrypted-ixs/Cargo.toml - arcis
echo "Updating encrypted-ixs/Cargo.toml..."
if [ -f "$REPO_ROOT/encrypted-ixs/Cargo.toml" ]; then
  sed -i '' "s/arcis = \"[^\"]*\"/arcis = \"$VERSION\"/" "$REPO_ROOT/encrypted-ixs/Cargo.toml"
  echo "  ✓ encrypted-ixs/Cargo.toml updated"
fi

echo ""
echo "Version updates complete. Now regenerating yarn.lock..."
echo ""

# Regenerate yarn.lock
rm -f "$REPO_ROOT/yarn.lock"
(cd "$REPO_ROOT" && yarn install)

echo ""
echo "Running arcium build..."
echo ""

arcium build

echo ""
echo "Done. Updated sol-privacy-mvp to version $VERSION"
echo ""
echo "Changes:"
git diff --stat 2>/dev/null || echo "(not in git repo or no changes)"

echo ""
echo "Next steps:"
echo "  1. Review the changes above"
echo "  2. Run tests: arcium test"
echo "  3. Commit if all tests pass"
