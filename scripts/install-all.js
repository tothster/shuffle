#!/usr/bin/env node

/**
 * Install All Dependencies Script
 * 
 * Installs dependencies for all project components:
 * 1. Validates environment first
 * 2. Installs contract dependencies (yarn)
 * 3. Installs SDK dependencies (npm)
 * 4. Builds SDK
 * 5. Links SDK globally for CLI usage
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
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

function runCommand(command, cwd, options = {}) {
  const { silent = false, allowFail = false } = options;
  
  log.cmd(`${command} (in ${path.basename(cwd)})`);
  
  try {
    const output = execSync(command, {
      cwd,
      encoding: 'utf-8',
      stdio: silent ? 'pipe' : 'inherit',
    });
    return { success: true, output };
  } catch (error) {
    if (allowFail) {
      return { success: false, error };
    }
    throw error;
  }
}

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

async function main() {
  log.header('📦 Shuffle Protocol - Install All Dependencies');
  
  // Step 1: Check environment
  log.step(1, 'Checking environment...');
  try {
    const { main: checkEnv } = require('./check-env.js');
    await checkEnv();
  } catch (error) {
    log.error('Environment check failed. Please fix the issues above and try again.');
    process.exit(1);
  }
  
  // Step 2: Install contract dependencies
  log.step(2, 'Installing contract dependencies (yarn)...');
  try {
    runCommand('yarn install', contractDir);
    log.success('Contract dependencies installed');
  } catch (error) {
    log.error(`Failed to install contract dependencies: ${error.message}`);
    const retry = await promptUser('Retry? (y/N): ', false);
    if (retry === 'y' || retry === 'yes') {
      return main();
    }
    process.exit(1);
  }
  
  // Step 3: Install SDK dependencies
  log.step(3, 'Installing SDK dependencies (npm)...');
  try {
    runCommand('npm install', sdkDir);
    log.success('SDK dependencies installed');
  } catch (error) {
    log.error(`Failed to install SDK dependencies: ${error.message}`);
    const retry = await promptUser('Retry? (y/N): ', false);
    if (retry === 'y' || retry === 'yes') {
      return main();
    }
    process.exit(1);
  }
  
  // Step 4: Build SDK
  log.step(4, 'Building SDK...');
  try {
    runCommand('npm run build', sdkDir);
    // Ensure CLI has execute permission
    runCommand('chmod +x dist/cli/index.js', sdkDir, { silent: true, allowFail: true });
    log.success('SDK built successfully');
  } catch (error) {
    log.error(`Failed to build SDK: ${error.message}`);
    const retry = await promptUser('Retry? (y/N): ', false);
    if (retry === 'y' || retry === 'yes') {
      return main();
    }
    process.exit(1);
  }
  
  // Step 5: Link SDK globally
  log.step(5, 'Linking SDK globally (npm link)...');
  console.log(`${colors.dim}    This makes the 'shuffle' CLI available in your terminal${colors.reset}`);
  
  try {
    runCommand('npm link', sdkDir);
    log.success('SDK linked globally');
    
    // Verify it worked
    const result = runCommand('which shuffle || where shuffle', rootDir, { silent: true, allowFail: true });
    if (result.success) {
      log.success(`shuffle CLI available at: ${result.output.trim()}`);
    }
  } catch (error) {
    log.warn('npm link failed - you may need to run with sudo or fix npm permissions');
    console.log(`${colors.dim}    See: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally${colors.reset}`);
    
    const proceed = await promptUser('Continue without global link? (Y/n): ', true);
    if (proceed !== 'y' && proceed !== 'yes') {
      process.exit(1);
    }
  }
  
  // Summary
  log.header('✅ Installation Complete!');
  console.log('Next steps:');
  console.log(`  1. Run ${colors.cyan}npm run setup:local${colors.reset} to start local validators`);
  console.log(`  2. Use ${colors.cyan}shuffle${colors.reset} CLI commands (balance, deposit, etc.)`);
  console.log(`  3. Run ${colors.cyan}npm run clean${colors.reset} when done to stop validators\n`);
}

main().catch((err) => {
  log.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
