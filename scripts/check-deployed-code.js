#!/usr/bin/env node

/**
 * Diagnostic script to check what version of code is actually deployed on Render
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 DEPLOYMENT DIAGNOSTIC REPORT');
console.log('================================');

// Check current working directory
console.log('📁 Current working directory:', process.cwd());

// Check if we're in the right location
const expectedFiles = ['server.js', 'package.json', 'src/services/aiService.js'];
console.log('📋 Checking for expected files:');

expectedFiles.forEach(file => {
  const exists = fs.existsSync(file);
  console.log(`   ${exists ? '✅' : '❌'} ${file}`);
});

// Check the specific line that's causing the error
const aiServicePath = 'src/services/aiService.js';
if (fs.existsSync(aiServicePath)) {
  console.log('\n🔍 Checking aiService.js content:');
  
  try {
    const content = fs.readFileSync(aiServicePath, 'utf8');
    const lines = content.split('\n');
    
    // Check line 130 (where we expect "let content")
    if (lines[129]) {
      console.log(`   Line 130: ${lines[129].trim()}`);
      if (lines[129].includes('let content')) {
        console.log('   ✅ Fix is present: "let content" found');
      } else if (lines[129].includes('const content')) {
        console.log('   ❌ Fix NOT applied: "const content" still present');
      } else {
        console.log('   ⚠️  Unexpected content at line 130');
      }
    }
    
    // Check line 143 (where the error occurs)
    if (lines[142]) {
      console.log(`   Line 143: ${lines[142].trim()}`);
    }
    
    // Check for OpenAI import style
    const firstFewLines = lines.slice(0, 5).join('\n');
    if (firstFewLines.includes('const { Configuration, OpenAIApi }')) {
      console.log('   ✅ OpenAI v3 import style detected');
    } else if (firstFewLines.includes('const { OpenAI }')) {
      console.log('   ❌ OpenAI v4 import style detected (should be v3)');
    } else {
      console.log('   ⚠️  OpenAI import not found in first 5 lines');
    }
    
  } catch (error) {
    console.log(`   ❌ Error reading aiService.js: ${error.message}`);
  }
} else {
  console.log('   ❌ aiService.js not found');
}

// Check git information if available
console.log('\n📊 Git Information:');
try {
  const { execSync } = require('child_process');
  const gitHash = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  const gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  
  console.log(`   Branch: ${gitBranch}`);
  console.log(`   Commit: ${gitHash.substring(0, 7)}`);
  
  // Check if this matches our expected latest commit
  if (gitHash.startsWith('c4720a5')) {
    console.log('   ✅ Latest commit deployed');
  } else {
    console.log('   ❌ NOT the latest commit (expected c4720a5...)');
  }
  
} catch (error) {
  console.log(`   ⚠️  Git info not available: ${error.message}`);
}

// Check environment
console.log('\n🌍 Environment:');
console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
console.log(`   PWD: ${process.env.PWD || 'not set'}`);

console.log('\n🎯 DIAGNOSIS:');
console.log('If you see "const content" at line 130, the deployment failed.');
console.log('If you see "let content" at line 130, there might be a caching issue.');
console.log('================================');