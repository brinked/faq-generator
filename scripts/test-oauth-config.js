#!/usr/bin/env node

/**
 * Test script to verify OAuth configuration
 * This script tests that the BASE_URL environment variable is properly configured
 * and that OAuth services initialize correctly.
 */

require('dotenv').config();

const logger = require('../src/utils/logger');

async function testOAuthConfiguration() {
  console.log('🔍 Testing OAuth Configuration...\n');

  // Test BASE_URL environment variable
  console.log('1. Checking BASE_URL environment variable:');
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    console.log('❌ BASE_URL is not set');
    console.log('   Please set BASE_URL environment variable to your production URL');
    console.log('   Example: BASE_URL=https://your-app-name.onrender.com');
    return false;
  } else {
    console.log(`✅ BASE_URL is set: ${baseUrl}`);
    
    // Validate URL format
    try {
      new URL(baseUrl);
      console.log('✅ BASE_URL is a valid URL');
    } catch (error) {
      console.log('❌ BASE_URL is not a valid URL format');
      return false;
    }
  }

  // Test Gmail service initialization
  console.log('\n2. Testing Gmail service initialization:');
  try {
    const GmailService = require('../src/services/gmailService');
    const gmailService = new GmailService();
    console.log('✅ Gmail service initialized successfully');
    
    // Check if required environment variables are set
    if (!process.env.GMAIL_CLIENT_ID) {
      console.log('⚠️  GMAIL_CLIENT_ID is not set');
    }
    if (!process.env.GMAIL_CLIENT_SECRET) {
      console.log('⚠️  GMAIL_CLIENT_SECRET is not set');
    }
  } catch (error) {
    console.log(`❌ Gmail service initialization failed: ${error.message}`);
    return false;
  }

  // Test Outlook service initialization
  console.log('\n3. Testing Outlook service initialization:');
  try {
    const OutlookService = require('../src/services/outlookService');
    const outlookService = new OutlookService();
    console.log('✅ Outlook service initialized successfully');
    
    // Check if required environment variables are set
    if (!process.env.OUTLOOK_CLIENT_ID) {
      console.log('⚠️  OUTLOOK_CLIENT_ID is not set');
    }
    if (!process.env.OUTLOOK_CLIENT_SECRET) {
      console.log('⚠️  OUTLOOK_CLIENT_SECRET is not set');
    }
  } catch (error) {
    console.log(`❌ Outlook service initialization failed: ${error.message}`);
    return false;
  }

  // Test auth routes initialization
  console.log('\n4. Testing auth routes initialization:');
  try {
    require('../src/routes/auth');
    console.log('✅ Auth routes initialized successfully');
  } catch (error) {
    console.log(`❌ Auth routes initialization failed: ${error.message}`);
    return false;
  }

  console.log('\n🎉 All OAuth configuration tests passed!');
  console.log('\nNext steps:');
  console.log('1. Make sure to set BASE_URL in your Render.com environment variables');
  console.log('2. Update your OAuth provider settings with the correct redirect URIs:');
  console.log(`   - Gmail: ${baseUrl}/api/auth/gmail/callback`);
  console.log(`   - Outlook: ${baseUrl}/api/auth/outlook/callback`);
  
  return true;
}

// Run the test
testOAuthConfiguration()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test failed with error:', error);
    process.exit(1);
  });