const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

/**
 * Debug route to help diagnose OAuth issues
 * This should be removed in production
 */

// Log all requests to this router
router.use((req, res, next) => {
  logger.info('OAuth Debug Request:', {
    method: req.method,
    path: req.path,
    query: req.query,
    headers: {
      host: req.headers.host,
      referer: req.headers.referer,
      'user-agent': req.headers['user-agent']
    }
  });
  next();
});

// Test OAuth redirect simulation
router.get('/test-redirect/:provider', (req, res) => {
  const { provider } = req.params;
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  
  // Simulate what the OAuth provider would do
  const redirectUrl = `${baseUrl}/api/auth/${provider}/callback?code=test_code_123&state=test_state`;
  
  res.send(`
    <html>
      <head>
        <title>OAuth Redirect Test</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; }
          .url { background: #f0f0f0; padding: 10px; border-radius: 5px; word-break: break-all; }
          .button { background: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>OAuth Redirect Test for ${provider}</h1>
          <p>This simulates what ${provider} would do after authentication.</p>
          <p><strong>Redirect URL that would be used:</strong></p>
          <div class="url">${redirectUrl}</div>
          <p>Click the button below to simulate the OAuth callback:</p>
          <a href="${redirectUrl}" class="button">Simulate OAuth Callback</a>
          
          <h2>Current Configuration:</h2>
          <ul>
            <li>BASE_URL: ${process.env.BASE_URL || 'Not set'}</li>
            <li>${provider.toUpperCase()}_REDIRECT_URI: ${process.env[`${provider.toUpperCase()}_REDIRECT_URI`] || 'Not set (using default)'}</li>
          </ul>
          
          <h2>What should happen:</h2>
          <ol>
            <li>The OAuth provider redirects to the URL above</li>
            <li>Express backend handles the request at /api/auth/${provider}/callback</li>
            <li>Backend exchanges the code for tokens</li>
            <li>Backend redirects to frontend with success parameters</li>
            <li>Frontend detects success and closes popup (if in popup)</li>
          </ol>
        </div>
      </body>
    </html>
  `);
});

// Show current OAuth configuration
router.get('/config', (req, res) => {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  
  const config = {
    environment: process.env.NODE_ENV || 'development',
    baseUrl: baseUrl,
    corsOrigin: process.env.CORS_ORIGIN || baseUrl,
    providers: {
      gmail: {
        clientId: process.env.GMAIL_CLIENT_ID ? '✅ Set' : '❌ Not set',
        clientSecret: process.env.GMAIL_CLIENT_SECRET ? '✅ Set' : '❌ Not set',
        redirectUri: process.env.GMAIL_REDIRECT_URI || `${baseUrl}/api/auth/gmail/callback`,
        correctFormat: (process.env.GMAIL_REDIRECT_URI || `${baseUrl}/api/auth/gmail/callback`).includes('/api/auth/gmail/callback')
      },
      outlook: {
        clientId: process.env.OUTLOOK_CLIENT_ID ? '✅ Set' : '❌ Not set',
        clientSecret: process.env.OUTLOOK_CLIENT_SECRET ? '✅ Set' : '❌ Not set',
        redirectUri: process.env.OUTLOOK_REDIRECT_URI || `${baseUrl}/api/auth/outlook/callback`,
        correctFormat: (process.env.OUTLOOK_REDIRECT_URI || `${baseUrl}/api/auth/outlook/callback`).includes('/api/auth/outlook/callback')
      }
    }
  };
  
  res.json(config);
});

// Test popup communication
router.get('/test-popup', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>OAuth Popup Test</title>
        <script>
          function testSuccess() {
            if (window.opener) {
              window.opener.postMessage({
                type: 'OAUTH_SUCCESS',
                provider: 'gmail',
                account: 'test-account-id'
              }, window.location.origin);
              document.getElementById('status').innerHTML = 'Message sent to parent window!';
              setTimeout(() => window.close(), 2000);
            } else {
              document.getElementById('status').innerHTML = 'No parent window found!';
            }
          }
          
          function testError() {
            if (window.opener) {
              window.opener.postMessage({
                type: 'OAUTH_ERROR',
                error: 'test_error',
                details: 'This is a test error'
              }, window.location.origin);
              document.getElementById('status').innerHTML = 'Error message sent to parent window!';
              setTimeout(() => window.close(), 2000);
            } else {
              document.getElementById('status').innerHTML = 'No parent window found!';
            }
          }
        </script>
      </head>
      <body style="font-family: Arial, sans-serif; padding: 20px;">
        <h1>OAuth Popup Communication Test</h1>
        <p>This page tests the popup communication with the parent window.</p>
        <button onclick="testSuccess()" style="padding: 10px 20px; margin: 5px;">Test Success Message</button>
        <button onclick="testError()" style="padding: 10px 20px; margin: 5px;">Test Error Message</button>
        <div id="status" style="margin-top: 20px; padding: 10px; background: #f0f0f0;"></div>
      </body>
    </html>
  `);
});

module.exports = router;