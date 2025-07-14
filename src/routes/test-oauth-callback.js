const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

// Test endpoint to verify OAuth callbacks are reaching the backend
router.get('/test-callback', (req, res) => {
  const { code, error, state } = req.query;
  
  logger.info('Test OAuth callback received:', {
    code: code ? 'present' : 'missing',
    error: error || 'none',
    state: state || 'none',
    fullQuery: req.query,
    headers: {
      host: req.headers.host,
      referer: req.headers.referer
    }
  });
  
  // Return a simple HTML page that shows the callback was received
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>OAuth Callback Test</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          padding: 20px;
          max-width: 600px;
          margin: 0 auto;
        }
        .success {
          color: green;
          font-weight: bold;
        }
        .error {
          color: red;
          font-weight: bold;
        }
        .code-block {
          background: #f0f0f0;
          padding: 10px;
          border-radius: 5px;
          margin: 10px 0;
          word-break: break-all;
        }
      </style>
    </head>
    <body>
      <h1>OAuth Callback Test</h1>
      <p class="${code ? 'success' : 'error'}">
        ${code ? '✅ Backend received the OAuth callback!' : '❌ No authorization code received'}
      </p>
      
      <h2>Received Parameters:</h2>
      <div class="code-block">
        <strong>Code:</strong> ${code || 'Not provided'}<br>
        <strong>Error:</strong> ${error || 'None'}<br>
        <strong>State:</strong> ${state || 'Not provided'}
      </div>
      
      <h2>What this means:</h2>
      <p>
        ${code ? 
          'The backend is successfully receiving OAuth callbacks. The issue might be with token exchange or redirect handling.' :
          'The OAuth provider did not send an authorization code. Check your OAuth configuration.'
        }
      </p>
      
      <h2>Debug Info:</h2>
      <div class="code-block">
        <strong>Request URL:</strong> ${req.url}<br>
        <strong>Host:</strong> ${req.headers.host}<br>
        <strong>Referer:</strong> ${req.headers.referer || 'Not provided'}
      </div>
      
      <script>
        // If in a popup, try to communicate with parent
        if (window.opener) {
          console.log('This is a popup window');
          document.body.innerHTML += '<p><strong>Popup detected!</strong> This window opened as a popup.</p>';
        } else {
          console.log('This is not a popup window');
          document.body.innerHTML += '<p><strong>Not a popup.</strong> This window opened normally.</p>';
        }
      </script>
    </body>
    </html>
  `);
});

module.exports = router;