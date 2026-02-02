import {
  x25519,
  RescueCipher,
  getMXEPublicKey,
  deserializeLE,
} from "@arcium-hq/client";
import { randomBytes } from "crypto";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export { RescueCipher, deserializeLE };

export interface EncryptionKeypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface EncryptedValue {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

/** Generate a new x25519 keypair for Arcium encryption */
export function generateEncryptionKeypair(): EncryptionKeypair {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

/** Create a RescueCipher from user's private key and MXE public key */
export function createCipher(
  privateKey: Uint8Array,
  mxePublicKey: Uint8Array
): RescueCipher {
  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
  return new RescueCipher(sharedSecret);
}

/** Encrypt a single value, returning ciphertext and nonce */
export function encryptValue(
  cipher: RescueCipher,
  value: bigint,
  nonce?: Uint8Array
): EncryptedValue {
  const nonceBytes = nonce || randomBytes(16);
  const encrypted = cipher.encrypt([value], nonceBytes as any);
  return {
    ciphertext: encrypted[0] as any,
    nonce: nonceBytes as any,
  };
}

/** Decrypt a ciphertext back to a bigint value */
export function decryptValue(
  cipher: RescueCipher,
  ciphertext: Uint8Array,
  nonce: Uint8Array
): bigint {
  const decrypted = cipher.decrypt([ciphertext] as any, nonce as any);
  return decrypted[0];
}

/** Fetch MXE public key with retry logic */
export async function fetchMXEPublicKey(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 5
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await getMXEPublicKey(provider, programId) as any;
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error("Failed to fetch MXE public key");
}

/** Convert a nonce Uint8Array to anchor.BN (for instruction args) */
export function nonceToBN(nonce: Uint8Array): anchor.BN {
  return new anchor.BN(deserializeLE(nonce).toString());
}
