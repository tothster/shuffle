#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build"
OUT_FILE="$BUILD_DIR/pinata_urls.json"
GATEWAY_BASE="${PINATA_GATEWAY_BASE:-https://gateway.pinata.cloud/ipfs}"
PINATA_API_BASE="${PINATA_API_BASE:-https://api.pinata.cloud}"
PINATA_NAME_PREFIX="${PINATA_NAME_PREFIX:-shuffle-}"
PINATA_PAGE_LIMIT="${PINATA_PAGE_LIMIT:-1000}"
DELETE_OLD_PINS="${DELETE_OLD_PINS:-1}"

for env_file in "$ROOT_DIR/.env" "$ROOT_DIR/../.env"; do
  if [ -z "${PINATA_JWT:-}" ] && [ -f "$env_file" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
done

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required" >&2
  exit 1
fi

if [ -z "${PINATA_JWT:-}" ]; then
  echo "Error: PINATA_JWT is not set" >&2
  echo "Set it with: export PINATA_JWT='<pinata-jwt>'" >&2
  exit 1
fi

CIRCUITS=(
  add_balance
  sub_balance
  transfer
  accumulate_order
  init_batch_state
  reveal_batch
  calculate_payout
  add_together
)

tmp_json="$(mktemp)"
echo '{}' > "$tmp_json"

delete_old_pins() {
  local page_offset=0
  local deleted=0

  echo "Checking existing Pinata pins with prefix '${PINATA_NAME_PREFIX}'..."
  while true; do
    local list_response
    list_response="$(curl -sS -X GET \
      "${PINATA_API_BASE}/data/pinList?status=pinned&pageLimit=${PINATA_PAGE_LIMIT}&pageOffset=${page_offset}" \
      -H "Authorization: Bearer ${PINATA_JWT}")"

    local rows_count
    rows_count="$(echo "$list_response" | jq -r '.rows | length')"

    if ! echo "$rows_count" | grep -Eq '^[0-9]+$'; then
      echo "Error: failed to read Pinata pin list" >&2
      echo "Response: $list_response" >&2
      rm -f "$tmp_json"
      exit 1
    fi

    if [ "$rows_count" -eq 0 ]; then
      break
    fi

    local matched
    matched="$(echo "$list_response" | jq -r --arg pfx "$PINATA_NAME_PREFIX" '.rows[]
      | select((.metadata.name // "") | startswith($pfx))
      | [.ipfs_pin_hash, (.metadata.name // "")] | @tsv')"

    if [ -n "$matched" ]; then
      while IFS=$'\t' read -r hash name; do
        [ -z "$hash" ] && continue
        echo "  - deleting $name ($hash)"
        curl -sS -X DELETE \
          "${PINATA_API_BASE}/pinning/unpin/${hash}" \
          -H "Authorization: Bearer ${PINATA_JWT}" >/dev/null
        deleted=$((deleted + 1))
      done <<< "$matched"
    fi

    page_offset=$((page_offset + PINATA_PAGE_LIMIT))
  done

  echo "Deleted ${deleted} existing '${PINATA_NAME_PREFIX}*.arcis' pins."
}

if [ "$DELETE_OLD_PINS" = "1" ]; then
  delete_old_pins
else
  echo "Skipping old pin deletion (DELETE_OLD_PINS=${DELETE_OLD_PINS})."
fi

echo "Uploading .arcis circuits to Pinata..."
for circuit in "${CIRCUITS[@]}"; do
  arcis_path="$BUILD_DIR/${circuit}.arcis"

  if [ ! -f "$arcis_path" ]; then
    echo "Error: missing circuit artifact $arcis_path" >&2
    rm -f "$tmp_json"
    exit 1
  fi

  echo "  - $circuit"

  response="$(curl -sS -X POST "${PINATA_API_BASE}/pinning/pinFileToIPFS" \
    -H "Authorization: Bearer ${PINATA_JWT}" \
    -F "file=@${arcis_path}" \
    -F "pinataMetadata={\"name\":\"shuffle-${circuit}.arcis\"}")"

  cid="$(echo "$response" | jq -r '.IpfsHash // empty')"
  if [ -z "$cid" ]; then
    echo "Error: Pinata upload failed for $circuit" >&2
    echo "Response: $response" >&2
    rm -f "$tmp_json"
    exit 1
  fi

  url="${GATEWAY_BASE}/${cid}"
  tmp2="$(mktemp)"
  jq --arg key "$circuit" --arg value "$url" '. + {($key): $value}' "$tmp_json" > "$tmp2"
  mv "$tmp2" "$tmp_json"
  echo "    CID: $cid"

done

mv "$tmp_json" "$OUT_FILE"
echo "Saved URLs to $OUT_FILE"

(
  cd "$ROOT_DIR"
  ./generate_offchain_snippet.sh
  node scripts/apply-circuit-urls.js
)

echo "Done. Updated off-chain circuit URLs in lib.rs and offchain snippet."
