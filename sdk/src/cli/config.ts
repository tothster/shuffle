/**
 * CLI Configuration Management
 * 
 * Handles loading Solana wallet from CLI config, network selection,
 * and encryption keypair management.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Keypair, Connection, clusterApiUrl } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { ShuffleClient } from "../client";
import { DEVNET_CONFIG, LOCALNET_CONFIG, MOCK_MODE } from "./devnet";
import { generateEncryptionKeypair } from "../encryption";

export interface CLIConfig {
  network: "devnet" | "localnet";
  connection: Connection;
  wallet: anchor.Wallet;
  keypairPath: string;
  mockMode: boolean;
  shuffleClient: ShuffleClient | null;
  encryptionPrivateKey: Uint8Array;
  userProfile?: string;  // Active user profile name
}

let config: CLIConfig | null = null;

/**
 * Get the base shuffle directory
 */
function getShuffleDir(): string {
  return path.join(os.homedir(), ".shuffle");
}

/**
 * Get the directory for a user profile (null = default user)
 */
function getUserDir(profile?: string): string {
  const shuffleDir = getShuffleDir();
  if (!profile || profile === "default") {
    return shuffleDir;
  }
  return path.join(shuffleDir, "users", profile);
}

/**
 * Load Solana keypair from profile or custom path
 */
function loadKeypair(customPath?: string, profile?: string): { keypair: Keypair; path: string } {
  // Try custom path first
  if (customPath && fs.existsSync(customPath)) {
    const raw = JSON.parse(fs.readFileSync(customPath, "utf-8"));
    return { keypair: Keypair.fromSecretKey(Uint8Array.from(raw)), path: customPath };
  }

  // For named profiles, use profile-specific keypair
  if (profile && profile !== "default") {
    const userDir = getUserDir(profile);
    const profileKeypairPath = path.join(userDir, "keypair.json");
    
    if (fs.existsSync(profileKeypairPath)) {
      const raw = JSON.parse(fs.readFileSync(profileKeypairPath, "utf-8"));
      return { keypair: Keypair.fromSecretKey(Uint8Array.from(raw)), path: profileKeypairPath };
    }
    
    // Create new keypair for this profile
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    const newKeypair = Keypair.generate();
    fs.writeFileSync(profileKeypairPath, JSON.stringify(Array.from(newKeypair.secretKey)));
    console.log(`Created new keypair for profile '${profile}': ${newKeypair.publicKey.toBase58()}`);
    return { keypair: newKeypair, path: profileKeypairPath };
  }

  // Try Solana CLI default path
  const defaultPath = path.join(os.homedir(), ".config", "solana", "id.json");
  if (fs.existsSync(defaultPath)) {
    const raw = JSON.parse(fs.readFileSync(defaultPath, "utf-8"));
    return { keypair: Keypair.fromSecretKey(Uint8Array.from(raw)), path: defaultPath };
  }

  throw new Error(
    "No Solana keypair found!\n" +
    "Run: solana-keygen new\n" +
    "Or specify: shuffle --keypair /path/to/keypair.json <command>"
  );
}

/**
 * Load or create encryption keypair (profile-specific if profile is set)
 */
function loadOrCreateEncryptionKey(profile?: string): Uint8Array {
  const userDir = getUserDir(profile);
  const encryptionPath = path.join(userDir, "encryption.json");

  if (fs.existsSync(encryptionPath)) {
    const raw = JSON.parse(fs.readFileSync(encryptionPath, "utf-8"));
    return Uint8Array.from(raw.privateKey);
  }

  // Create new keypair
  const keypair = generateEncryptionKeypair();
  
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  
  fs.writeFileSync(encryptionPath, JSON.stringify({
    privateKey: Array.from(keypair.privateKey),
    publicKey: Array.from(keypair.publicKey),
  }));

  return keypair.privateKey;
}

/**
 * Get RPC URL for network
 */
function getRpcUrl(network: "devnet" | "localnet"): string {
  if (network === "localnet") {
    return "http://127.0.0.1:8899";
  }
  return clusterApiUrl("devnet");
}

/**
 * Path to persistent config file
 */
function getConfigPath(): string {
  return path.join(os.homedir(), ".shuffle", "config.json");
}

/**
 * Load saved config from ~/.shuffle/config.json
 */
export function loadSavedConfig(): { network?: "devnet" | "localnet" } {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch {
    // Ignore errors, return empty config
  }
  return {};
}

/**
 * Save config to ~/.shuffle/config.json
 */
export function saveConfig(key: string, value: string): void {
  const shuffleDir = path.join(os.homedir(), ".shuffle");
  const configPath = getConfigPath();
  
  if (!fs.existsSync(shuffleDir)) {
    fs.mkdirSync(shuffleDir, { recursive: true });
  }

  const existing = loadSavedConfig();
  const updated = { ...existing, [key]: value };
  
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));
}

/**
 * Get a saved config value
 */
export function getSavedConfig(key: string): string | undefined {
  const saved = loadSavedConfig();
  return (saved as Record<string, string>)[key];
}

/**
 * Initialize CLI configuration
 */
export async function loadConfig(opts: {
  network?: string;
  keypair?: string;
  mock?: boolean;
  user?: string;
}): Promise<CLIConfig> {
  // Use saved config as defaults if --network/--mock not provided
  const savedConfig = loadSavedConfig();
  const network = (opts.network as "devnet" | "localnet") || savedConfig.network || "devnet";
  const savedMock = (savedConfig as Record<string, string>).mock === "true";
  const mockMode = opts.mock !== undefined ? opts.mock : savedMock || MOCK_MODE;
  const userProfile = opts.user;
  
  const { keypair, path: keypairPath } = loadKeypair(opts.keypair, userProfile);
  const wallet = new anchor.Wallet(keypair);
  const connection = new Connection(getRpcUrl(network), "confirmed");
  const encryptionPrivateKey = loadOrCreateEncryptionKey(userProfile);

  let shuffleClient: ShuffleClient | null = null;

  // Select program ID based on network
  const programId = network === "localnet" 
    ? LOCALNET_CONFIG.programId 
    : DEVNET_CONFIG.programId;

  if (!mockMode) {
    try {
      shuffleClient = await ShuffleClient.create({
        connection,
        wallet,
        programId,
        clusterOffset: 0,
      });
      shuffleClient.initEncryption(encryptionPrivateKey);
    } catch (e: any) {
      // Will use mock mode if client creation fails
      console.warn(`Failed to connect to Shuffle protocol: ${e.message?.slice(0, 50)}`);
    }
  }

  config = {
    network,
    connection,
    wallet,
    keypairPath,
    mockMode: mockMode || !shuffleClient,
    shuffleClient,
    encryptionPrivateKey,
    userProfile,
  };

  return config;
}

/**
 * Get current config (must call loadConfig first)
 */
export function getConfig(): CLIConfig {
  if (!config) {
    throw new Error("Config not loaded. This is a bug.");
  }
  return config;
}

/**
 * Get CLI version from package.json
 */
export function getVersion(): string {
  try {
    const pkgPath = path.join(__dirname, "..", "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.version || "0.1.0";
  } catch {
    return "0.1.0";
  }
}
