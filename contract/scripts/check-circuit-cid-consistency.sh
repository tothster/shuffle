#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_RS="$ROOT_DIR/programs/shuffle_protocol/src/lib.rs"
BUILD_DIR="$ROOT_DIR/build"

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required" >&2
  exit 1
fi

extract_url() {
  local fn_name="$1"
  awk -v fn="$fn_name" '
    $0 ~ "pub fn "fn"\\(" { in_fn=1 }
    in_fn && $0 ~ /source: "/ {
      match($0, /source: "[^"]+"/)
      if (RSTART > 0) {
        s=substr($0, RSTART+9, RLENGTH-10)
        print s
        exit
      }
    }
  ' "$LIB_RS"
}

circuits=(
  add_balance
  sub_balance
  transfer
  accumulate_order
  init_batch_state
  reveal_batch
  calculate_payout
  add_together
)

status=0
for c in "${circuits[@]}"; do
  fn="init_${c}_comp_def"
  url="$(extract_url "$fn")"

  if [ -z "$url" ]; then
    echo "$c: ERROR (source URL not found in $fn)"
    status=1
    continue
  fi

  local_file="$BUILD_DIR/${c}.arcis"
  remote_file="/tmp/shuffle_${c}_remote.arcis"

  curl -L --max-time 30 -sS "$url" -o "$remote_file"

  if cmp -s "$local_file" "$remote_file"; then
    echo "$c: MATCH"
  else
    echo "$c: MISMATCH"
    status=1
  fi

done

exit $status
