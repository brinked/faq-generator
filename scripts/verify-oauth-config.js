require('dotenv').config();
const logger = require('../src/utils/logger');

console.log('\n=== OAuth Configuration Verification ===\n');

// Check BASE_URL
const baseUrl = process.env.BASE_URL;
console.log('BASE_URL:', baseUrl || '❌ NOT SET - This is required!');

// Check Gmail configuration
console.log('\n📧 Gmail OAuth Configuration:');
console.log('GMAIL_CLIENT_ID:', process.env.GMAIL_CLIENT_ID ? '✅ Set' : '❌ Not set');
console.log('GMAIL_CLIENT_SECRET:', process.env.GMAIL_CLIENT_SECRET ? '✅ Set' : '❌ Not set');

const gmailRedirectUri = process.env.GMAIL_REDIRECT_URI || `${baseUrl}/api/auth/gmail/callback`;
console.log('GMAIL_REDIRECT_URI:', gmailRedirectUri);

// Check if redirect URI has /api prefix
if (gmailRedirectUri && !gmailRedirectUri.includes('/api/auth/gmail/callback')) {
  console.log('⚠️  WARNING: Gmail redirect URI is missing /api prefix!');
  console.log('   Current:', gmailRedirectUri);
  console.log('   Should be:', `${baseUrl}/api/auth/gmail/callback`);
}

// Check Outlook configuration
console.log('\n📨 Outlook OAuth Configuration:');
console.log('OUTLOOK_CLIENT_ID:', process.env.OUTLOOK_CLIENT_ID ? '✅ Set' : '❌ Not set');
console.log('OUTLOOK_CLIENT_SECRET:', process.env.OUTLOOK_CLIENT_SECRET ? '✅ Set' : '❌ Not set');

const outlookRedirectUri = process.env.OUTLOOK_REDIRECT_URI || `${baseUrl}/api/auth/outlook/callback`;
console.log('OUTLOOK_REDIRECT_URI:', outlookRedirectUri);

// Check if redirect URI has /api prefix
if (outlookRedirectUri && !outlookRedirectUri.includes('/api/auth/outlook/callback')) {
  console.log('⚠️  WARNING: Outlook redirect URI is missing /api prefix!');
  console.log('   Current:', outlookRedirectUri);
  console.log('   Should be:', `${baseUrl}/api/auth/outlook/callback`);
}

// Check CORS configuration
console.log('\n🔒 CORS Configuration:');
console.log('CORS_ORIGIN:', process.env.CORS_ORIGIN || baseUrl);

console.log('\n=== Required Actions ===\n');

if (!baseUrl) {
  console.log('1. ❌ Set BASE_URL environment variable to your Render.com URL');
  console.log('   Example: BASE_URL=https://faq-generator-web.onrender.com');
}

let hasIssues = false;

// Gmail issues
if (gmailRedirectUri && !gmailRedirectUri.includes('/api/auth/gmail/callback')) {
  hasIssues = true;
  console.log('\n2. ❌ Fix Gmail OAuth Configuration:');
  console.log('   a) In Google Cloud Console, update the redirect URI to:');
  console.log(`      ${baseUrl}/api/auth/gmail/callback`);
  console.log('   b) In Render.com environment variables, set:');
  console.log(`      GMAIL_REDIRECT_URI=${baseUrl}/api/auth/gmail/callback`);
}

// Outlook issues
if (outlookRedirectUri && !outlookRedirectUri.includes('/api/auth/outlook/callback')) {
  hasIssues = true;
  console.log('\n3. ❌ Fix Outlook OAuth Configuration:');
  console.log('   a) In Azure Portal, update the redirect URI to:');
  console.log(`      ${baseUrl}/api/auth/outlook/callback`);
  console.log('   b) In Render.com environment variables, set:');
  console.log(`      OUTLOOK_REDIRECT_URI=${baseUrl}/api/auth/outlook/callback`);
}

if (!hasIssues && baseUrl) {
  console.log('✅ OAuth configuration looks correct!');
  console.log('\nMake sure the redirect URIs in your OAuth providers match:');
  console.log(`   Gmail: ${gmailRedirectUri}`);
  console.log(`   Outlook: ${outlookRedirectUri}`);
}

console.log('\n=== Testing OAuth Configuration ===\n');
console.log('You can test your configuration by visiting:');
console.log(`${baseUrl}/api/auth/debug/oauth-config`);

console.log('\n=== OAuth Flow Debugging ===\n');
console.log('To debug the OAuth flow:');
console.log('1. Open browser Developer Tools (F12)');
console.log('2. Go to the Network tab');
console.log('3. Try connecting Gmail/Outlook');
console.log('4. Look for requests to /api/auth/gmail/callback or /api/auth/outlook/callback');
console.log('5. If you see the callback going to the main page instead, the redirect URI is wrong');

process.exit(0);