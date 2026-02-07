import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { getCompDefAccOffset, getArciumProgramId, getArciumAccountBaseSeed, getArciumProgram } from "@arcium-hq/client";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as os from "os";

const keypairPath = `${os.homedir()}/.config/solana/id.json`;
const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));

const connection = new Connection("https://devnet.helius-rpc.com/?api-key=a8e1a5ce-29c6-4356-b3f9-54c1c650ac08");
const wallet = new Wallet(keypair);
const provider = new AnchorProvider(connection, wallet, {});

const programId = new PublicKey("J5B3CHigkr6Tiz9iRACMNk355uY5wFpVCq6847urV3Et");
const circuitName = "add_balance";

const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
const offset = getCompDefAccOffset(circuitName);

const [compDefPDA] = PublicKey.findProgramAddressSync(
  [baseSeed, programId.toBuffer(), offset],
  getArciumProgramId()
);

console.log(`Comp def PDA for ${circuitName}: ${compDefPDA.toBase58()}`);

const arciumProgram = getArciumProgram(provider);

arciumProgram.account.computationDefinitionAccount.fetch(compDefPDA)
  .then((account: any) => {
    console.log("\nAccount data:", JSON.stringify(account, null, 2));
    console.log("\nCircuit source type:", account.circuitSource?.offChain ? "OffChain" : "OnChain or None");
    if (account.circuitSource?.offChain) {
      console.log("Circuit URL:", account.circuitSource.offChain.source);
    }
  })
  .catch((e: any) => {
    console.error("\nError fetching account:", e.message);
  });
