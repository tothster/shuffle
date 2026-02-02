"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "shuffle-encryption-key";

interface EncryptionState {
  publicKey: Uint8Array | null;
  privateKey: Uint8Array | null;
  isReady: boolean;
}

/**
 * Manages the user's x25519 encryption keypair.
 * Stores private key in localStorage for persistence across reloads.
 * The actual cipher creation happens inside ShuffleClient (server-side).
 */
export function useEncryption() {
  // Start with null/false to avoid hydration mismatch
  // The actual state is only set client-side in useEffect
  const [state, setState] = useState<EncryptionState>({
    publicKey: null,
    privateKey: null,
    isReady: false,
  });

  // Track if we're on client side (prevents hydration mismatch)
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    // Generate or load keypair using Web Crypto (browser-compatible)
    const loadKeypair = async () => {
      let privateKeyBytes: Uint8Array;

      try {
        const stored = localStorage.getItem(STORAGE_KEY);

        if (stored) {
          privateKeyBytes = new Uint8Array(JSON.parse(stored));
        } else {
          // Generate 32 random bytes for x25519 private key
          privateKeyBytes = new Uint8Array(32);
          crypto.getRandomValues(privateKeyBytes);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(privateKeyBytes)));
        }

        // x25519 public key derivation requires the actual curve25519 library,
        // which runs inside the SDK. For the frontend, we store the private key
        // and let the SDK derive the public key when needed.
        setState({
          publicKey: privateKeyBytes, // Will be replaced with actual pubkey from SDK
          privateKey: privateKeyBytes,
          isReady: true,
        });
      } catch (err) {
        console.error("Failed to load encryption keypair:", err);
      }
    };

    loadKeypair();
  }, [mounted]);

  const resetKeypair = useCallback(() => {
    if (!mounted) return;

    localStorage.removeItem(STORAGE_KEY);
    const privateKeyBytes = new Uint8Array(32);
    crypto.getRandomValues(privateKeyBytes);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(privateKeyBytes)));
    setState({
      publicKey: privateKeyBytes,
      privateKey: privateKeyBytes,
      isReady: true,
    });
  }, [mounted]);

  return { ...state, resetKeypair };
}
