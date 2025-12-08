#!/usr/bin/env node

/**
 * Build script for Baasix Drizzle
 * - Compiles TypeScript files
 * - Copies static assets (app, templates, etc.)
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.join(__dirname, 'dist');
const baasixDir = path.join(__dirname, 'baasix');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function copyRecursive(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();

  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach(childItemName => {
      copyRecursive(
        path.join(src, childItemName),
        path.join(dest, childItemName)
      );
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

function cleanDist() {
  log('🧹 Cleaning dist directory...', colors.yellow);
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });
  log('✓ Cleaned dist directory', colors.green);
}

function compileTypeScript() {
  log('🔨 Compiling TypeScript files...', colors.blue);
  try {
    execSync('tsc', { stdio: 'inherit' });
    log('✓ TypeScript compilation complete', colors.green);
  } catch (error) {
    log('✗ TypeScript compilation failed', colors.red);
    process.exit(1);
  }
}

function copyAssets() {
  log('📦 Copying static assets...', colors.blue);

  const assetsToCopy = [
    { src: 'app', dest: 'app', name: 'App files' },
    { src: 'templates', dest: 'templates', name: 'Templates' },
  ];

  for (const asset of assetsToCopy) {
    const srcPath = path.join(baasixDir, asset.src);
    const destPath = path.join(distDir, asset.dest);

    if (fs.existsSync(srcPath)) {
      log(`  → Copying ${asset.name}...`, colors.reset);
      copyRecursive(srcPath, destPath);
      log(`  ✓ Copied ${asset.name}`, colors.green);
    } else {
      log(`  ⚠ ${asset.name} not found at ${srcPath}`, colors.yellow);
    }
  }

  log('✓ All assets copied', colors.green);
}

function checkAppSync() {
  log('🔍 Checking for admin app...', colors.blue);
  const appIndexPath = path.join(baasixDir, 'app', 'index.html');
  
  if (!fs.existsSync(appIndexPath)) {
    log('✗ Admin app not found!', colors.red);
    log('  Please run "npm run sync" to copy the admin app build before building.', colors.yellow);
    log(`  Expected: ${appIndexPath}`, colors.yellow);
    process.exit(1);
  }
  log('✓ Admin app found', colors.green);
}

function build() {
  log('\n' + colors.bright + '🚀 Starting Baasix build process...\n' + colors.reset);

  try {
    checkAppSync();
    cleanDist();
    compileTypeScript();
    copyAssets();

    log('\n' + colors.bright + colors.green + '✅ Build completed successfully!\n' + colors.reset);
  } catch (error) {
    log('\n' + colors.red + '❌ Build failed: ' + error.message + '\n' + colors.reset);
    process.exit(1);
  }
}

build();
