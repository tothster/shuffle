#!/bin/bash
set -e

PINATA_API_KEY="016d836ee3eb37002836"
PINATA_SECRET_KEY="71c06d316fe0201cfd677fe179c772d5f12fac33822097f65b50f336fdd5f313"
BUILD_DIR="build"

upload_to_pinata() {
    local FILE_PATH=$1
    local FILE_NAME=$(basename "$FILE_PATH")

    echo "Uploading $FILE_NAME to Pinata..." >&2

    RESPONSE=$(curl -s -X POST \
        -H "pinata_api_key: $PINATA_API_KEY" \
        -H "pinata_secret_api_key: $PINATA_SECRET_KEY" \
        -F "file=@$FILE_PATH" \
        https://api.pinata.cloud/pinning/pinFileToIPFS)

    CID=$(echo "$RESPONSE" | jq -r '.IpfsHash')

    if [ "$CID" = "null" ] || [ -z "$CID" ]; then
        echo "Failed to upload $FILE_NAME" >&2
        return 1
    fi

    echo "$CID"
}

CIRCUITS=("add_balance" "sub_balance" "transfer" "accumulate_order" "init_batch_state" "reveal_batch" "calculate_payout" "add_together")

OUTPUT_FILE="$BUILD_DIR/pinata_urls.json"
echo "{" > "$OUTPUT_FILE"

FIRST=true
for CIRCUIT in "${CIRCUITS[@]}"; do
    ARCIS_FILE="$BUILD_DIR/${CIRCUIT}.arcis"

    if [ ! -f "$ARCIS_FILE" ]; then
        echo "Circuit file not found: $ARCIS_FILE" >&2
        continue
    fi

    CID=$(upload_to_pinata "$ARCIS_FILE")

    if [ -n "$CID" ] && [ "$CID" != "null" ]; then
        URL="https://gateway.pinata.cloud/ipfs/$CID"
        echo "✓ $CIRCUIT: $URL" >&2

        if [ "$FIRST" = true ]; then
            FIRST=false
        else
            echo "," >> "$OUTPUT_FILE"
        fi
        echo "  \"$CIRCUIT\": \"$URL\"" >> "$OUTPUT_FILE"
    fi
done

echo "}" >> "$OUTPUT_FILE"
echo "" >&2
echo "✓ Pinata URLs saved to $OUTPUT_FILE" >&2
