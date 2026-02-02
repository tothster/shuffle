#!/usr/bin/env node

/**
 * Environment Validation Script
 * 
 * Checks that all required dependencies are installed:
 * - Solana CLI (v1.18+)
 * - Anchor CLI (v0.30+)
 * - Arcium CLI (v0.6+)
 * - Node.js (v18+)
 * - Rust/Cargo
 * - Docker
 */

const { execSync } = require('child_process');
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
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  header: (msg) => console.log(`\n${colors.bold}${colors.cyan}${msg}${colors.reset}\n`),
};

// Version requirements (minimum versions)
const requirements = {
  node: { min: '18.0.0', command: 'node --version', parse: (v) => v.replace('v', '') },
  solana: { min: '1.18.0', command: 'solana --version', parse: (v) => v.match(/(\d+\.\d+\.\d+)/)?.[1] },
  anchor: { min: '0.30.0', command: 'anchor --version', parse: (v) => v.match(/(\d+\.\d+\.\d+)/)?.[1] },
  arcium: { min: '0.6.0', command: 'arcium --version', parse: (v) => v.match(/(\d+\.\d+\.\d+)/)?.[1] },
  rust: { min: null, command: 'rustc --version', parse: (v) => v.match(/(\d+\.\d+\.\d+)/)?.[1] },
  docker: { min: null, command: 'docker --version', parse: (v) => v.match(/(\d+\.\d+\.\d+)/)?.[1] },
  'docker-daemon': { min: null, command: 'docker info', parse: () => 'running', errorMessage: 'Docker daemon is not running. Start Docker Desktop and try again.' },
};

function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

function checkTool(name, config) {
  try {
    const output = execSync(config.command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const version = config.parse(output);
    
    if (!version) {
      return { installed: true, version: 'unknown', valid: true };
    }
    
    if (config.min) {
      const valid = compareVersions(version, config.min) >= 0;
      return { installed: true, version, valid, required: config.min };
    }
    
    return { installed: true, version, valid: true };
  } catch (e) {
    return { installed: false, version: null, valid: false, required: config.min, errorMessage: config.errorMessage };
  }
}

function promptUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().trim());
    });
  });
}

async function main() {
  log.header('🔍 Shuffle Protocol - Environment Check');
  
  const results = {};
  let hasErrors = false;
  let hasWarnings = false;
  
  console.log('Checking required dependencies...\n');
  
  for (const [name, config] of Object.entries(requirements)) {
    const result = checkTool(name, config);
    results[name] = result;
    
    // Format display name nicely (docker-daemon -> Docker Daemon)
    const displayName = name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    
    if (!result.installed) {
      if (result.errorMessage) {
        log.error(`${displayName}: ${result.errorMessage}`);
      } else {
        log.error(`${displayName}: Not installed${result.required ? ` (requires v${result.required}+)` : ''}`);
      }
      hasErrors = true;
    } else if (!result.valid) {
      log.warn(`${displayName}: v${result.version} (requires v${result.required}+)`);
      hasWarnings = true;
    } else {
      log.success(`${displayName}: v${result.version}${result.required ? ` (requires v${result.required}+)` : ''}`);
    }
  }
  
  console.log('');
  
  if (hasErrors) {
    log.error('Some required dependencies are missing!\n');
    console.log('Installation guides:');
    console.log('  • Solana: https://docs.solana.com/cli/install-solana-cli-tools');
    console.log('  • Anchor: https://www.anchor-lang.com/docs/installation');
    console.log('  • Arcium: https://docs.arcium.com/getting-started/installation');
    console.log('  • Node.js: https://nodejs.org/');
    console.log('  • Rust: https://rustup.rs/');
    console.log('  • Docker: https://docs.docker.com/get-docker/\n');
    
    const retry = await promptUser('Would you like to retry after fixing? (y/n): ');
    if (retry === 'y' || retry === 'yes') {
      console.log('');
      return main();
    }
    
    process.exit(1);
  }
  
  if (hasWarnings) {
    log.warn('Some dependencies have version warnings, but may still work.\n');
    const proceed = await promptUser('Proceed anyway? (y/n): ');
    if (proceed !== 'y' && proceed !== 'yes') {
      process.exit(1);
    }
  }
  
  log.success('All environment checks passed!\n');
  return true;
}

// Allow importing as module or running directly
if (require.main === module) {
  main().catch((err) => {
    log.error(`Unexpected error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main, checkTool, requirements };
