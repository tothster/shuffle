#!/usr/bin/env node

/**
 * Setup Local Environment Script
 * 
 * Sets up local environment for SDK CLI testing:
 * 1. Validates environment
 * 2. Ensures correct test files have .skip
 * 3. Cleans old test-ledger if needed
 * 4. Runs arcium test --detach
 * 5. Displays usage instructions
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  header: (msg) => console.log(`\n${colors.bold}${colors.cyan}${msg}${colors.reset}\n`),
  step: (num, msg) => console.log(`\n${colors.bold}[${num}]${colors.reset} ${msg}`),
  cmd: (msg) => console.log(`${colors.dim}    $ ${msg}${colors.reset}`),
};

const rootDir = path.resolve(__dirname, '..');
const contractDir = path.join(rootDir, 'contract');
const testsDir = path.join(contractDir, 'tests');
const testLedgerDir = path.join(contractDir, '.anchor', 'test-ledger');

// Test files configuration
const testFiles = {
  sdkSetup: '0_sdk_setup.ts',      // Should run (no .skip)
  fullFlow: '3_full_flow.ts',      // Should be skipped
};

function promptUser(question, defaultYes = null) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const trimmed = answer.toLowerCase().trim();
      
      // If empty answer and we have a default, use it
      if (trimmed === '' && defaultYes !== null) {
        resolve(defaultYes ? 'y' : 'n');
      } else {
        resolve(trimmed);
      }
    });
  });
}

function ensureTestSkipPattern(filePath, shouldSkip) {
  const fileName = path.basename(filePath);
  
  if (!fs.existsSync(filePath)) {
    log.warn(`Test file not found: ${fileName}`);
    return false;
  }
  
  let content = fs.readFileSync(filePath, 'utf-8');
  
  // Check current state
  const hasSkip = /describe\.skip\s*\(/.test(content);
  const hasDescribeNoSkip = /describe\s*\([^.]/.test(content) || /^describe\(/.test(content);
  
  if (shouldSkip && !hasSkip) {
    // Need to add .skip
    content = content.replace(/describe\s*\(/g, 'describe.skip(');
    fs.writeFileSync(filePath, content);
    log.info(`Added .skip to ${fileName}`);
    return true;
  } else if (!shouldSkip && hasSkip) {
    // Need to remove .skip
    content = content.replace(/describe\.skip\s*\(/g, 'describe(');
    fs.writeFileSync(filePath, content);
    log.info(`Removed .skip from ${fileName}`);
    return true;
  } else {
    log.success(`${fileName} is correctly configured (skip=${shouldSkip})`);
    return false;
  }
}

async function main() {
  log.header('🚀 Shuffle Protocol - Local Setup for SDK CLI Testing');
  
  // Step 1: Check environment
  log.step(1, 'Checking environment...');
  try {
    const { main: checkEnv } = require('./check-env.js');
    await checkEnv();
  } catch (error) {
    log.error('Environment check failed. Please fix the issues above and try again.');
    process.exit(1);
  }
  
  // Step 2: Configure test files
  log.step(2, 'Configuring test files...');
  console.log(`${colors.dim}    Only 0_sdk_setup.ts should run, others should be skipped${colors.reset}`);
  
  // Ensure correct skip patterns
  ensureTestSkipPattern(path.join(testsDir, testFiles.fullFlow), true);  // Should skip
  ensureTestSkipPattern(path.join(testsDir, testFiles.sdkSetup), false); // Should NOT skip
  
  // Step 3: Clean old test-ledger if exists
  log.step(3, 'Checking for old test-ledger...');
  
  if (fs.existsSync(testLedgerDir)) {
    log.warn(`Found existing test-ledger at: ${testLedgerDir}`);
    const shouldClean = await promptUser('Delete old test-ledger and start fresh? (Y/n): ', true);
    
    if (shouldClean === 'y' || shouldClean === 'yes') {
      try {
        fs.rmSync(testLedgerDir, { recursive: true, force: true });
        log.success('Old test-ledger removed');
      } catch (error) {
        log.error(`Failed to remove test-ledger: ${error.message}`);
        const proceed = await promptUser('Continue anyway? (y/N): ', false);
        if (proceed !== 'y' && proceed !== 'yes') {
          process.exit(1);
        }
      }
    }
  } else {
    log.success('No existing test-ledger found');
  }
  
  // Step 4: Check for running containers and stop them
  log.step(4, 'Checking for running containers...');
  
  const dockerComposeFile = path.join(contractDir, 'artifacts', 'docker-compose-arx-env.yml');
  
  // Check if any arcium containers are running
  try {
    const dockerPs = execSync('docker ps --format "{{.Names}}" 2>/dev/null', { encoding: 'utf-8' }).trim();
    const runningContainers = dockerPs.split('\n').filter(c => 
      c.includes('arcium') || c.includes('arx') || c.includes('localnet')
    );
    
    if (runningContainers.length > 0) {
      log.warn(`Found ${runningContainers.length} running container(s): ${runningContainers.join(', ')}`);
      const shouldStop = await promptUser('Stop running containers before starting fresh? (Y/n): ', true);
      
      if (shouldStop === 'y' || shouldStop === 'yes') {
        // Use docker-compose if available
        if (fs.existsSync(dockerComposeFile)) {
          log.info('Stopping containers via docker-compose...');
          try {
            execSync(`docker compose -f "${dockerComposeFile}" stop`, { stdio: 'pipe' });
            log.success('Containers stopped');
          } catch (e) {
            log.warn('docker-compose stop failed, trying manual stop...');
          }
        }
        
        // Also stop any remaining containers manually
        for (const container of runningContainers) {
          try {
            execSync(`docker stop ${container}`, { stdio: 'pipe' });
            log.success(`Stopped: ${container}`);
          } catch (e) {
            log.warn(`Failed to stop: ${container}`);
          }
        }
        
        // Kill any solana-test-validator processes
        execSync('pkill -f solana-test-validator 2>/dev/null || true', { stdio: 'pipe' });
        log.success('Cleanup complete');
      }
    } else {
      log.success('No running containers found');
    }
  } catch (error) {
    log.info('Docker not available or no containers running');
  }
  
  // Step 5: Build the program first (ensures IDL is correct after key sync)
  log.step(5, 'Building program with arcium build...');
  console.log(`${colors.dim}    This syncs keys and regenerates IDL with correct program ID${colors.reset}\n`);
  
  try {
    log.cmd('cd contract && arcium build');
    execSync('arcium build', {
      cwd: contractDir,
      stdio: 'inherit',
    });
    log.success('Build completed successfully!');
  } catch (error) {
    log.error(`Build failed: ${error.message}`);
    const retry = await promptUser('Retry build? (y/N): ', false);
    if (retry === 'y' || retry === 'yes') {
      return main();
    }
    process.exit(1);
  }
  
  // Step 6: Run arcium test --detach
  log.step(6, 'Starting local environment (arcium test --detach)...');
  console.log(`${colors.dim}    This will deploy and run 0_sdk_setup.ts${colors.reset}`);
  console.log(`${colors.dim}    Validators will remain running after tests complete${colors.reset}\n`);
  
  const proceed = await promptUser('Start local environment? (Y/n): ', true);
  if (proceed !== 'y' && proceed !== 'yes') {
    log.info('Aborted by user');
    process.exit(0);
  }
  
  console.log('');
  log.info('Running arcium test --detach...');
  log.cmd('cd contract && arcium test --detach\n');
  
  try {
    // Run in foreground so user can see output
    execSync('arcium test --detach', {
      cwd: contractDir,
      stdio: 'inherit',
    });
    
    log.success('Local environment started successfully!');
  } catch (error) {
    log.error(`Failed to start local environment: ${error.message}`);
    
    const retry = await promptUser('Retry? (y/N): ', false);
    if (retry === 'y' || retry === 'yes') {
      return main();
    }
    process.exit(1);
  }
  
  // Step 7: Sync program ID from contract to SDK
  log.step(7, 'Syncing program ID to SDK...');
  
  try {
    // Read program ID from contract lib.rs
    const libRsPath = path.join(contractDir, 'programs', 'shuffle_protocol', 'src', 'lib.rs');
    const libRsContent = fs.readFileSync(libRsPath, 'utf-8');
    const programIdMatch = libRsContent.match(/declare_id!\s*\(\s*"([A-Za-z0-9]+)"\s*\)/);
    
    if (programIdMatch) {
      const contractProgramId = programIdMatch[1];
      log.info(`Contract program ID: ${contractProgramId}`);
      
      // Update SDK devnet.ts LOCALNET_CONFIG
      const devnetTsPath = path.join(rootDir, 'sdk', 'src', 'cli', 'devnet.ts');
      let devnetContent = fs.readFileSync(devnetTsPath, 'utf-8');
      
      // Check if it needs updating
      const localnetMatch = devnetContent.match(/LOCALNET_CONFIG\s*=\s*\{[^}]*programId:\s*new\s+PublicKey\s*\(\s*"([A-Za-z0-9]+)"\s*\)/);
      
      if (localnetMatch && localnetMatch[1] !== contractProgramId) {
        log.info(`Updating SDK LOCALNET_CONFIG: ${localnetMatch[1]} → ${contractProgramId}`);
        devnetContent = devnetContent.replace(
          /LOCALNET_CONFIG\s*=\s*\{([^}]*programId:\s*new\s+PublicKey\s*\(\s*")([A-Za-z0-9]+)("\s*\))/,
          `LOCALNET_CONFIG = {$1${contractProgramId}$3`
        );
        fs.writeFileSync(devnetTsPath, devnetContent);
        
        // Also update constants.ts
        const constantsTsPath = path.join(rootDir, 'sdk', 'src', 'constants.ts');
        let constantsContent = fs.readFileSync(constantsTsPath, 'utf-8');
        constantsContent = constantsContent.replace(
          /export\s+const\s+PROGRAM_ID\s*=\s*new\s+PublicKey\s*\(\s*"[A-Za-z0-9]+"\s*\)/,
          `export const PROGRAM_ID = new PublicKey("${contractProgramId}")`
        );
        fs.writeFileSync(constantsTsPath, constantsContent);
        
        // Rebuild SDK
        log.info('Rebuilding SDK...');
        log.cmd('cd sdk && npm run build');
        const sdkDir = path.join(rootDir, 'sdk');
        execSync('npm run build', { cwd: sdkDir, stdio: 'pipe' });
        // Ensure CLI has execute permission
        execSync('chmod +x dist/cli/index.js', { cwd: sdkDir, stdio: 'pipe' });
        log.success('SDK rebuilt with updated program ID');

        // Re-link SDK globally (force to overwrite existing binary)
        try {
          log.info('Linking SDK globally (npm link --force)...');
          log.cmd('cd sdk && npm link --force');
          execSync('npm link --force', { cwd: sdkDir, stdio: 'pipe' });
          log.success('SDK linked globally');
        } catch (e) {
          log.warn('npm link --force failed - you may need to fix npm permissions');
        }
      } else {
        log.success('SDK program ID already matches contract');
      }
    }
  } catch (error) {
    log.warn(`Failed to sync program ID: ${error.message}`);
    log.info('You may need to manually update sdk/src/cli/devnet.ts');
  }
  
  // Step 8: Display usage instructions
  log.header('✅ Local Environment Ready!');
  
  console.log('The local validators are now running. You can use the SDK CLI:\n');
  console.log(`  ${colors.cyan}shuffle --network localnet init${colors.reset}       # Create privacy account`);
  console.log(`  ${colors.cyan}shuffle --network localnet balance${colors.reset}    # View encrypted balances`);
  console.log(`  ${colors.cyan}shuffle --network localnet deposit USDC 100${colors.reset}`);
  console.log(`  ${colors.cyan}shuffle --network localnet order TSLA_USDC buy 50${colors.reset}\n`);
  
  console.log('When done, run:');
  console.log(`  ${colors.cyan}npm run clean${colors.reset}    # Stop validators and clean up\n`);
  
  console.log(`${colors.dim}Validators running at: http://127.0.0.1:8899${colors.reset}\n`);
}

main().catch((err) => {
  log.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
