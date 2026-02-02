#!/usr/bin/env node

/**
 * Cleanup Script
 * 
 * Cleans up local development environment:
 * 1. Stops Arcium/Solana docker containers
 * 2. Kills any running solana-test-validator processes
 * 3. Removes test-ledger directory
 * 4. Optionally removes node_modules and build artifacts
 */

const { execSync } = require('child_process');
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
const sdkDir = path.join(rootDir, 'sdk');
const testLedgerDir = path.join(contractDir, '.anchor', 'test-ledger');

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

function runCommand(command, options = {}) {
  const { silent = false, allowFail = true } = options;
  
  try {
    log.cmd(command);
    const output = execSync(command, {
      encoding: 'utf-8',
      stdio: silent ? 'pipe' : ['pipe', 'pipe', 'pipe'],
    });
    return { success: true, output: output.trim() };
  } catch (error) {
    if (!allowFail) {
      throw error;
    }
    return { success: false, error: error.message };
  }
}

async function main() {
  log.header('🧹 Shuffle Protocol - Cleanup');
  
  // Step 1: Stop Docker containers
  log.step(1, 'Stopping Docker containers...');
  
  // First try the arcium docker-compose file (this is the correct way)
  const dockerComposeFile = path.join(contractDir, 'artifacts', 'docker-compose-arx-env.yml');
  
  if (fs.existsSync(dockerComposeFile)) {
    log.info('Found arcium docker-compose file, stopping containers...');
    const result = runCommand(`docker compose -f "${dockerComposeFile}" stop`, { silent: true });
    if (result.success) {
      log.success('Stopped arcium containers via docker-compose');
    } else {
      log.warn('Failed to stop via docker-compose, trying manual stop...');
    }
  }
  
  // Also find and stop any remaining arcium-related containers
  const dockerPs = runCommand('docker ps --format "{{.Names}}" 2>/dev/null', { silent: true });
  
  if (dockerPs.success && dockerPs.output) {
    const containers = dockerPs.output.split('\n').filter(c => 
      c.includes('arcium') || c.includes('arx') || c.includes('solana') || c.includes('localnet')
    );
    
    if (containers.length > 0) {
      log.info(`Found ${containers.length} related container(s): ${containers.join(', ')}`);
      
      for (const container of containers) {
        const result = runCommand(`docker stop ${container}`, { silent: true });
        if (result.success) {
          log.success(`Stopped container: ${container}`);
        } else {
          log.warn(`Failed to stop container: ${container}`);
        }
      }
    } else {
      log.success('No arcium-related Docker containers running');
    }
  } else {
    log.info('Docker not available or no containers running');
  }
  
  // Step 2: Kill solana-test-validator processes
  log.step(2, 'Stopping solana-test-validator processes...');
  
  const pkillResult = runCommand('pkill -f solana-test-validator 2>/dev/null || true', { silent: true });
  log.success('Sent stop signal to any running validators');
  
  // Also try to kill any anchor/arcium related processes
  runCommand('pkill -f "anchor" 2>/dev/null || true', { silent: true });
  
  // Step 3: Remove test-ledger
  log.step(3, 'Removing test-ledger...');
  
  if (fs.existsSync(testLedgerDir)) {
    const shouldRemove = await promptUser(`Remove ${testLedgerDir}? (Y/n): `, true);
    
    if (shouldRemove === 'y' || shouldRemove === 'yes') {
      try {
        fs.rmSync(testLedgerDir, { recursive: true, force: true });
        log.success('Test-ledger removed');
      } catch (error) {
        log.error(`Failed to remove test-ledger: ${error.message}`);
      }
    } else {
      log.info('Skipped test-ledger removal');
    }
  } else {
    log.success('No test-ledger found');
  }
  
  // Step 4: Optional deep clean
  log.step(4, 'Deep clean (optional)...');
  
  const deepClean = await promptUser('Also remove node_modules and build artifacts? (y/N): ', false);
  
  if (deepClean === 'y' || deepClean === 'yes') {
    console.log('');
    
    // Remove contract node_modules
    const contractNodeModules = path.join(contractDir, 'node_modules');
    if (fs.existsSync(contractNodeModules)) {
      log.info('Removing contract/node_modules...');
      fs.rmSync(contractNodeModules, { recursive: true, force: true });
      log.success('Removed contract/node_modules');
    }
    
    // Remove SDK node_modules and dist
    const sdkNodeModules = path.join(sdkDir, 'node_modules');
    const sdkDist = path.join(sdkDir, 'dist');
    
    if (fs.existsSync(sdkNodeModules)) {
      log.info('Removing sdk/node_modules...');
      fs.rmSync(sdkNodeModules, { recursive: true, force: true });
      log.success('Removed sdk/node_modules');
    }
    
    if (fs.existsSync(sdkDist)) {
      log.info('Removing sdk/dist...');
      fs.rmSync(sdkDist, { recursive: true, force: true });
      log.success('Removed sdk/dist');
    }
    
    // Remove contract target (Rust build)
    const contractTarget = path.join(contractDir, 'target');
    if (fs.existsSync(contractTarget)) {
      const removeTarget = await promptUser('Also remove contract/target (Rust build cache, ~500MB+)? (y/N): ', false);
      if (removeTarget === 'y' || removeTarget === 'yes') {
        log.info('Removing contract/target (this may take a moment)...');
        fs.rmSync(contractTarget, { recursive: true, force: true });
        log.success('Removed contract/target');
      }
    }
  }
  
  log.header('✅ Cleanup Complete!');
  console.log('To set up the environment again, run:');
  console.log(`  ${colors.cyan}npm run install:all${colors.reset}   # Install dependencies`);
  console.log(`  ${colors.cyan}npm run setup:local${colors.reset}   # Start local validators\n`);
}

main().catch((err) => {
  log.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
