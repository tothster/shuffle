#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const anchor = require('@coral-xyz/anchor');
const { PublicKey, Keypair, SystemProgram } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, mintTo } = require('@solana/spl-token');
const {
  getCompDefAccOffset,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  buildFinalizeCompDefTx,
  getArciumEnv,
  getMXEPublicKey,
  getLookupTableAddress,
  getArciumProgram,
} = require('@arcium-hq/client');

process.env.ARCIUM_CLUSTER_OFFSET = process.env.ARCIUM_CLUSTER_OFFSET || '456';

const DEVNET_RPC = 'https://devnet.helius-rpc.com/?api-key=a8e1a5ce-29c6-4356-b3f9-54c1c650ac08';
const MINTS = {
  USDC: new PublicKey('2rGgkS8piPnFbJxLhyyfXnTuLqPW8zPoM7YXnovjBK9s'),
  TSLA: new PublicKey('EmRuN3yRqizBKwVSahm6bPW4YEUZ4iGcP95SQg1MdDfZ'),
  SPY: new PublicKey('HgaWt2CGQLT3RTNt4HQpCFhMpeo8amadH6KcQ5gVCDvQ'),
  AAPL: new PublicKey('7JohqPXEVJ3Mm8TrHf7KQ7F4Nq4JnxvfTLQFn4D5nghj'),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readKpJson(p) {
  const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

async function retry(fn, maxRetries = 5, delayMs = 1500) {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === maxRetries) throw e;
      await sleep(delayMs);
      delayMs = Math.floor(delayMs * 1.5);
    }
  }
}

async function initCompDef(program, owner, provider, circuitName, methodName) {
  const baseSeedCompDefAcc = getArciumAccountBaseSeed('ComputationDefinitionAccount');
  const offset = getCompDefAccOffset(circuitName);

  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
    getArciumProgramId(),
  )[0];

  const existingAccount = await provider.connection.getAccountInfo(compDefPDA);
  if (existingAccount) {
    console.log(`  ✓ ${circuitName} comp def already exists`);
    return;
  }

  const arciumProgram = getArciumProgram(provider);
  const mxeAccount = getMXEAccAddress(program.programId);
  const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
  const lutAddress = getLookupTableAddress(program.programId, mxeAcc.lutOffsetSlot);

  console.log(`  -> init ${circuitName}`);
  await retry(async () => {
    await program.methods[methodName]()
      .accountsPartial({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount,
        addressLookupTable: lutAddress,
      })
      .signers([owner])
      .rpc({ commitment: 'confirmed' });
  });

  // Off-chain circuit sources are included at init_*_comp_def time.
  // Keep this path deterministic across Arcium v0.8.x deployments.
  console.log(`  ✓ ${circuitName} comp def initialized`);
  await sleep(1500);
}

async function main() {
  const walletPath = path.join(os.homedir(), '.config/solana/id.json');
  const owner = readKpJson(walletPath);
  const connection = new anchor.web3.Connection(DEVNET_RPC, 'confirmed');
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(owner), {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'target/idl/shuffle_protocol.json'), 'utf8'));
  const program = new anchor.Program(idl, provider);

  console.log('Program:', program.programId.toBase58());
  console.log('Owner:', owner.publicKey.toBase58());

  const [poolPDA] = PublicKey.findProgramAddressSync([Buffer.from('pool')], program.programId);
  const [batchAccumulatorPDA] = PublicKey.findProgramAddressSync([Buffer.from('batch_accumulator')], program.programId);

  const [vaultUsdcPDA] = PublicKey.findProgramAddressSync([Buffer.from('vault'), Buffer.from('usdc')], program.programId);
  const [vaultTslaPDA] = PublicKey.findProgramAddressSync([Buffer.from('vault'), Buffer.from('tsla')], program.programId);
  const [vaultSpyPDA] = PublicKey.findProgramAddressSync([Buffer.from('vault'), Buffer.from('spy')], program.programId);
  const [vaultAaplPDA] = PublicKey.findProgramAddressSync([Buffer.from('vault'), Buffer.from('aapl')], program.programId);

  const [reserveUsdcPDA] = PublicKey.findProgramAddressSync([Buffer.from('reserve'), Buffer.from('usdc')], program.programId);
  const [reserveTslaPDA] = PublicKey.findProgramAddressSync([Buffer.from('reserve'), Buffer.from('tsla')], program.programId);
  const [reserveSpyPDA] = PublicKey.findProgramAddressSync([Buffer.from('reserve'), Buffer.from('spy')], program.programId);
  const [reserveAaplPDA] = PublicKey.findProgramAddressSync([Buffer.from('reserve'), Buffer.from('aapl')], program.programId);
  const [faucetVaultPDA] = PublicKey.findProgramAddressSync([Buffer.from('faucet_usdc')], program.programId);

  const poolInfo = await connection.getAccountInfo(poolPDA);
  if (!poolInfo) {
    console.log('Initializing pool/vaults...');
    await retry(async () => {
      await program.methods
        .initialize(50, 8)
        .accountsPartial({
          payer: owner.publicKey,
          authority: owner.publicKey,
          operator: owner.publicKey,
          treasury: owner.publicKey,
          pool: poolPDA,
          usdcMint: MINTS.USDC,
          tslaMint: MINTS.TSLA,
          spyMint: MINTS.SPY,
          aaplMint: MINTS.AAPL,
          vaultUsdc: vaultUsdcPDA,
          vaultTsla: vaultTslaPDA,
          vaultSpy: vaultSpyPDA,
          vaultAapl: vaultAaplPDA,
          reserveUsdc: reserveUsdcPDA,
          reserveTsla: reserveTslaPDA,
          reserveSpy: reserveSpyPDA,
          reserveAapl: reserveAaplPDA,
          faucetVault: faucetVaultPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc({ commitment: 'confirmed' });
    });
    console.log('✓ pool initialized');
  } else {
    console.log('✓ pool already exists');
  }

  const batchInfo = await connection.getAccountInfo(batchAccumulatorPDA);
  if (!batchInfo) {
    console.log('Initializing batch accumulator...');
    await retry(async () => {
      await program.methods
        .initBatchAccumulator()
        .accountsPartial({
          payer: owner.publicKey,
          batchAccumulator: batchAccumulatorPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc({ commitment: 'confirmed' });
    });
    console.log('✓ batch accumulator initialized');
  } else {
    console.log('✓ batch accumulator already exists');
  }

  console.log('Initializing computation definitions...');
  await initCompDef(program, owner, provider, 'add_balance', 'initAddBalanceCompDef');
  await initCompDef(program, owner, provider, 'sub_balance', 'initSubBalanceCompDef');
  await initCompDef(program, owner, provider, 'transfer', 'initTransferCompDef');
  await initCompDef(program, owner, provider, 'accumulate_order', 'initAccumulateOrderCompDef');
  await initCompDef(program, owner, provider, 'init_batch_state', 'initInitBatchStateCompDef');
  await initCompDef(program, owner, provider, 'reveal_batch', 'initRevealBatchCompDef');
  await initCompDef(program, owner, provider, 'calculate_payout', 'initCalculatePayoutCompDef');

  // Optional: fund faucet vault if owner is mint authority.
  try {
    const faucetInfo = await connection.getTokenAccountBalance(faucetVaultPDA);
    const current = BigInt(faucetInfo.value.amount);
    if (current < 1_000_000_000n) {
      await mintTo(connection, owner, MINTS.USDC, faucetVaultPDA, owner, 10_000_000_000);
      console.log('✓ faucet vault funded with 10,000 USDC');
    } else {
      console.log('✓ faucet vault already funded');
    }
  } catch (e) {
    console.log('! faucet funding skipped:', e.message || String(e));
  }

  // Initialize batch state ciphertexts if needed.
  try {
    const batchAcc = await program.account.batchAccumulator.fetch(batchAccumulatorPDA);
    const nonce = BigInt(batchAcc.mxeNonce.toString());
    if (nonce === 0n) {
      console.log('Initializing batch state encrypted zeros...');
      const arciumEnv = getArciumEnv();
      const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);
      const offset = new anchor.BN(Date.now());
      await retry(async () => {
        await program.methods
          .initBatchState(offset)
          .accountsPartial({
            payer: owner.publicKey,
            batchAccumulator: batchAccumulatorPDA,
            mxeAccount: getMXEAccAddress(program.programId),
            mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
            executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
            computationAccount: getComputationAccAddress(arciumEnv.arciumClusterOffset, offset),
            compDefAccount: getCompDefAccAddress(
              program.programId,
              Buffer.from(getCompDefAccOffset('init_batch_state')).readUInt32LE(),
            ),
            clusterAccount,
            poolAccount: arciumEnv.feePool,
            clockAccount: arciumEnv.arciumClock,
            arciumProgram: getArciumProgramId(),
            systemProgram: SystemProgram.programId,
          })
          .signers([owner])
          .rpc({ skipPreflight: true, commitment: 'confirmed' });
      });
      await sleep(6000);
      console.log('✓ batch state initialized');
    } else {
      console.log('✓ batch state already initialized');
    }
  } catch (e) {
    console.log('! batch state init skipped:', e.message || String(e));
  }

  console.log('Done. Devnet program bootstrap complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
