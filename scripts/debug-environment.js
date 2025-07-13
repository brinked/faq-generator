#!/usr/bin/env node

/**
 * Environment Debug Script
 * 
 * This script helps troubleshoot environment variable issues in production.
 * It will show what environment variables are actually being used.
 * 
 * Usage: node scripts/debug-environment.js
 */

require('dotenv').config();
const logger = require('../src/utils/logger');

function debugEnvironment() {
  console.log('='.repeat(60));
  console.log('ENVIRONMENT DEBUG INFORMATION');
  console.log('='.repeat(60));
  
  // Basic environment info
  console.log('Node Environment:', process.env.NODE_ENV || 'undefined');
  console.log('Port:', process.env.PORT || 'undefined');
  console.log('');
  
  // URL Configuration
  console.log('URL CONFIGURATION:');
  console.log('- BASE_URL:', process.env.BASE_URL || 'undefined');
  console.log('- CORS_ORIGIN:', process.env.CORS_ORIGIN || 'undefined');
  console.log('');
  
  // Computed values (what the app actually uses)
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const corsOrigin = process.env.CORS_ORIGIN || baseUrl;
  
  console.log('COMPUTED VALUES (what the app uses):');
  console.log('- Effective BASE_URL:', baseUrl);
  console.log('- Effective CORS_ORIGIN:', corsOrigin);
  console.log('');
  
  // OAuth Configuration
  console.log('OAUTH REDIRECT URIS:');
  const gmailRedirect = process.env.GMAIL_REDIRECT_URI || `${baseUrl}/api/auth/gmail/callback`;
  const outlookRedirect = process.env.OUTLOOK_REDIRECT_URI || `${baseUrl}/api/auth/outlook/callback`;
  
  console.log('- Gmail Redirect URI:', gmailRedirect);
  console.log('- Outlook Redirect URI:', outlookRedirect);
  console.log('');
  
  // OAuth Client IDs (masked for security)
  console.log('OAUTH CLIENT CONFIGURATION:');
  console.log('- Gmail Client ID:', process.env.GMAIL_CLIENT_ID ? `${process.env.GMAIL_CLIENT_ID.substring(0, 10)}...` : 'undefined');
  console.log('- Outlook Client ID:', process.env.OUTLOOK_CLIENT_ID ? `${process.env.OUTLOOK_CLIENT_ID.substring(0, 10)}...` : 'undefined');
  console.log('');
  
  // Database
  console.log('DATABASE CONFIGURATION:');
  if (process.env.DATABASE_URL) {
    const dbUrl = process.env.DATABASE_URL.replace(/:[^:@]*@/, ':***@');
    console.log('- Database URL:', dbUrl);
  } else {
    console.log('- Database URL: undefined');
  }
  console.log('');
  
  // Check for localhost references
  console.log('LOCALHOST CHECK:');
  const hasLocalhostBase = baseUrl.includes('localhost');
  const hasLocalhostCors = corsOrigin.includes('localhost');
  const hasLocalhostGmail = gmailRedirect.includes('localhost');
  const hasLocalhostOutlook = outlookRedirect.includes('localhost');
  
  console.log('- BASE_URL contains localhost:', hasLocalhostBase);
  console.log('- CORS_ORIGIN contains localhost:', hasLocalhostCors);
  console.log('- Gmail redirect contains localhost:', hasLocalhostGmail);
  console.log('- Outlook redirect contains localhost:', hasLocalhostOutlook);
  console.log('');
  
  // Recommendations
  console.log('RECOMMENDATIONS:');
  if (hasLocalhostBase || hasLocalhostCors || hasLocalhostGmail || hasLocalhostOutlook) {
    console.log('❌ ISSUE FOUND: Localhost URLs detected!');
    console.log('');
    console.log('To fix this:');
    console.log('1. Set BASE_URL environment variable to your production URL');
    console.log('2. Remove or clear CORS_ORIGIN (it will use BASE_URL automatically)');
    console.log('3. Remove GMAIL_REDIRECT_URI and OUTLOOK_REDIRECT_URI (they will be auto-generated)');
    console.log('4. Restart your service after making changes');
  } else {
    console.log('✅ No localhost URLs detected - configuration looks good!');
  }
  
  console.log('='.repeat(60));
}

// Run the debug
debugEnvironment();