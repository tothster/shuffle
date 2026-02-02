"use client";

import { useState, useEffect } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { ShuffleClient } from "shuffle-sdk";

export function useShuffle(encryptionPrivateKey: Uint8Array | null) {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const [client, setClient] = useState<ShuffleClient | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!anchorWallet || !encryptionPrivateKey) {
      setClient(null);
      setIsReady(false);
      return;
    }

    let cancelled = false;

    const init = async () => {
      try {
        setError(null);
        const c = await ShuffleClient.create({
          connection,
          wallet: anchorWallet as any,
        });
        if (cancelled) return;
        // Initialize encryption inside the client
        c.initEncryption(encryptionPrivateKey);
        setClient(c);
        setIsReady(true);
      } catch (err: any) {
        if (cancelled) return;
        setError(err.message || "Failed to initialize SDK");
        setIsReady(false);
      }
    };

    init();
    return () => { cancelled = true; };
  }, [connection, anchorWallet, encryptionPrivateKey]);

  return { client, isReady, error };
}
