#!/usr/bin/env bash
set -euo pipefail

# Checks all circuit CIDs referenced by the program against common gateways.

cids=(
  QmQ4Jd2KEQZXPzE5xgXGQTz8BjtF4BHemSsjXWaE3QTuGT
  QmdbkwigmEYcXPaDGdFJYhVKGC2c1WDfznBBxt8Rc1vZmM
  Qmaeq41Z2VQu6o5z4cmm4uK4EHXP14EneyTRSE33H5Vt3T
  QmbBzp7G3o2KqGPFdzjB5Y7ioujpvR5TT54bpLsoo7QZv7
  Qmc311AdUo1eE7Pm8F8ctDEfX5FJ2SQ4ATDvJi4YXMjmQ8
  QmT8bDc6mba5H3bpAJrtDFBYnSTKLKoMFxhm6TmnMNHSnA
  QmSfQjsdRAiXEU9b8qH2d1fgmyn1P7wcRCd28DE1e5Y3nC
  QmQAK9JvndSP3YePGq9ciSeuCk8boHfQy5xi3RZTHS9iDW
)

for cid in "${cids[@]}"; do
  echo "===== CID $cid ====="
  urls=(
    "https://gateway.pinata.cloud/ipfs/$cid"
    "https://ipfs.io/ipfs/$cid"
    "https://dweb.link/ipfs/$cid"
  )

  for url in "${urls[@]}"; do
    echo "-- $url"
    if ! curl -sS -L --max-time 25 -o /tmp/shuffle_cid_body.bin -D /tmp/shuffle_cid_headers.txt "$url"; then
      echo "curl_failed"
      continue
    fi

    code=$(awk 'toupper($1) ~ /^HTTP\// { c=$2 } END { print c }' /tmp/shuffle_cid_headers.txt)
    ctype=$(awk 'BEGIN{IGNORECASE=1} /^content-type:/ { sub(/\r$/, "", $0); print substr($0, 15) }' /tmp/shuffle_cid_headers.txt | tail -n1)
    bytes=$(wc -c < /tmp/shuffle_cid_body.bin | tr -d ' ')
    sha=$(shasum -a 256 /tmp/shuffle_cid_body.bin | awk '{print $1}')

    echo "status=$code content_type=${ctype:-NA} bytes=$bytes sha256=$sha"
  done
  echo
done
