const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const EmailService = require('../services/emailService');
const GmailService = require('../services/gmailService');
const OutlookService = require('../services/outlookService');

const emailService = new EmailService();
const gmailService = new GmailService();
const outlookService = new OutlookService();

// Dynamic CORS origin configuration
const baseUrl = process.env.BASE_URL;
if (!baseUrl) {
  throw new Error('BASE_URL environment variable is required for OAuth redirects');
}
const corsOrigin = process.env.CORS_ORIGIN || baseUrl;

/**
 * Get authentication options and available endpoints
 */
router.get('/', (req, res) => {
  res.json({
    message: 'FAQ Generator Authentication API',
    available_endpoints: {
      gmail: {
        auth_url: '/api/auth/gmail/url',
        callback: '/api/auth/gmail/callback',
        description: 'Gmail OAuth 2.0 authentication'
      },
      outlook: {
        auth_url: '/api/auth/outlook/url',
        callback: '/api/auth/outlook/callback',
        description: 'Outlook OAuth 2.0 authentication'
      },
      account_management: {
        test: 'POST /api/auth/test/:accountId',
        refresh: 'POST /api/auth/refresh/:accountId',
        disconnect: 'DELETE /api/auth/disconnect/:accountId'
      }
    },
    usage: {
      step1: 'GET /api/auth/gmail/url or /api/auth/outlook/url to get authorization URL',
      step2: 'User visits authorization URL and grants permissions',
      step3: 'OAuth callback automatically handles token exchange and account creation'
    }
  });
});

/**
 * Debug endpoint to check OAuth configuration
 */
router.get('/debug/oauth-config', (req, res) => {
  const config = {
    baseUrl: process.env.BASE_URL,
    corsOrigin: corsOrigin,
    gmail: {
      redirectUri: process.env.GMAIL_REDIRECT_URI || `${process.env.BASE_URL}/api/auth/gmail/callback`,
      hasClientId: !!process.env.GMAIL_CLIENT_ID,
      hasClientSecret: !!process.env.GMAIL_CLIENT_SECRET
    },
    outlook: {
      redirectUri: process.env.OUTLOOK_REDIRECT_URI || `${process.env.BASE_URL}/api/auth/outlook/callback`,
      hasClientId: !!process.env.OUTLOOK_CLIENT_ID,
      hasClientSecret: !!process.env.OUTLOOK_CLIENT_SECRET
    }
  };
  
  logger.info('OAuth configuration debug:', config);
  res.json(config);
});

/**
 * Get Gmail authorization URL
 */
router.get('/gmail/url', async (req, res) => {
  try {
    const authUrl = gmailService.getAuthUrl();
    
    logger.info('Generated Gmail auth URL:', {
      authUrl,
      baseUrl: process.env.BASE_URL,
      expectedCallback: `${process.env.BASE_URL}/api/auth/gmail/callback`
    });
    
    res.json({
      success: true,
      authUrl,
      provider: 'gmail'
    });
  } catch (error) {
    logger.error('Error getting Gmail auth URL:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate authorization URL'
    });
  }
});

/**
 * Handle Gmail OAuth callback
 */
router.get('/gmail/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    
    if (error) {
      logger.error('Gmail OAuth error:', error);
      const errorRedirectUrl = `${corsOrigin}/?error=oauth_denied`;
      logger.error('Redirecting due to OAuth denial:', {
        corsOrigin,
        errorRedirectUrl
      });
      return res.redirect(errorRedirectUrl);
    }
    
    if (!code) {
      const errorRedirectUrl = `${corsOrigin}/?error=no_code`;
      logger.error('No authorization code received:', {
        corsOrigin,
        errorRedirectUrl
      });
      return res.redirect(errorRedirectUrl);
    }

    // Exchange code for tokens
    let tokens;
    try {
      tokens = await gmailService.getTokens(code);
    } catch (tokenError) {
      logger.error('Failed to get Gmail tokens:', {
        error: tokenError.message,
        originalError: tokenError.originalError
      });
      return res.redirect(`${corsOrigin}/?error=token_exchange_failed&details=${encodeURIComponent(tokenError.message)}`);
    }
    
    // Set credentials and get user profile
    gmailService.setCredentials(tokens);
    const profile = await gmailService.getUserProfile();
    
    // Calculate token expiry - Gmail tokens can have either expiry_date or expires_in
    let tokenExpiresAt;
    if (tokens.expiry_date) {
      // expiry_date is already a timestamp in milliseconds
      tokenExpiresAt = new Date(tokens.expiry_date);
    } else if (tokens.expires_in) {
      // expires_in is seconds from now
      tokenExpiresAt = new Date(Date.now() + (tokens.expires_in * 1000));
    } else {
      // Default to 1 hour from now if no expiry info
      tokenExpiresAt = new Date(Date.now() + (3600 * 1000));
    }
    
    // Create or update account
    const accountData = {
      email_address: profile.email,
      provider: 'gmail',
      display_name: profile.name,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: tokenExpiresAt
    };
    
    const account = await emailService.createOrUpdateAccount(accountData);
    
    logger.info(`Gmail account connected: ${profile.email}`);
    
    const redirectUrl = `${corsOrigin}/?success=gmail_connected&account=${account.id}`;
    logger.info('Redirecting after Gmail OAuth success:', {
      corsOrigin,
      redirectUrl,
      accountId: account.id
    });
    
    res.redirect(redirectUrl);
    
  } catch (error) {
    logger.error('Gmail callback error:', error);
    const errorRedirectUrl = `${corsOrigin}/?error=connection_failed`;
    logger.error('Redirecting after Gmail OAuth error:', {
      corsOrigin,
      errorRedirectUrl,
      errorMessage: error.message
    });
    res.redirect(errorRedirectUrl);
  }
});

/**
 * Get Outlook authorization URL
 */
router.get('/outlook/url', async (req, res) => {
  try {
    const authUrl = await outlookService.getAuthUrl();
    
    res.json({
      success: true,
      authUrl,
      provider: 'outlook'
    });
  } catch (error) {
    logger.error('Error getting Outlook auth URL:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate authorization URL'
    });
  }
});

/**
 * Handle Outlook OAuth callback
 */
router.get('/outlook/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    
    logger.info('Outlook OAuth callback received', {
      hasCode: !!code,
      hasError: !!error,
      error: error,
      query: req.query,
      headers: req.headers,
      url: req.url
    });
    
    if (error) {
      logger.error('Outlook OAuth error:', error);
      return res.redirect(`${corsOrigin}/?error=oauth_denied`);
    }
    
    if (!code) {
      return res.redirect(`${corsOrigin}/?error=no_code`);
    }

    // Exchange code for tokens
    const tokens = await outlookService.getTokens(code);
    
    // Get user profile
    const profile = await outlookService.getUserProfile(tokens.access_token);
    
    // Calculate token expiry - Outlook tokens typically have expires_in
    let tokenExpiresAt;
    if (tokens.expires_in) {
      // expires_in is seconds from now
      tokenExpiresAt = new Date(Date.now() + (tokens.expires_in * 1000));
    } else {
      // Default to 1 hour from now if no expiry info
      tokenExpiresAt = new Date(Date.now() + (3600 * 1000));
    }
    
    // Create or update account
    const accountData = {
      email_address: profile.mail || profile.userPrincipalName,
      provider: 'outlook',
      display_name: profile.displayName,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: tokenExpiresAt
    };
    
    const account = await emailService.createOrUpdateAccount(accountData);
    
    logger.info(`Outlook account connected: ${profile.mail || profile.userPrincipalName}`);
    
    res.redirect(`${corsOrigin}/?success=outlook_connected&account=${account.id}`);
    
  } catch (error) {
    logger.error('Outlook callback error:', error);
    res.redirect(`${corsOrigin}/?error=connection_failed`);
  }
});

/**
 * Test account connection
 */
router.post('/test/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    
    const testResult = await emailService.testAccountConnection(accountId);
    
    res.json({
      success: true,
      result: testResult
    });
    
  } catch (error) {
    logger.error(`Error testing account ${req.params.accountId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Refresh account tokens
 */
router.post('/refresh/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    
    const account = await emailService.refreshAccountToken(accountId);
    
    res.json({
      success: true,
      account: {
        id: account.id,
        email_address: account.email_address,
        provider: account.provider,
        status: account.status,
        updated_at: account.updated_at
      }
    });
    
  } catch (error) {
    logger.error(`Error refreshing tokens for account ${req.params.accountId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Disconnect account
 */
router.delete('/disconnect/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    
    await emailService.deleteAccount(accountId);
    
    res.json({
      success: true,
      message: 'Account disconnected successfully'
    });
    
  } catch (error) {
    logger.error(`Error disconnecting account ${req.params.accountId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get authentication status
 */
router.get('/status', async (req, res) => {
  try {
    const accounts = await emailService.getAllAccounts();
    
    const accountStatus = accounts.map(account => ({
      id: account.id,
      email_address: account.email_address,
      provider: account.provider,
      display_name: account.display_name,
      status: account.status,
      last_sync_at: account.last_sync_at,
      created_at: account.created_at
    }));
    
    res.json({
      success: true,
      accounts: accountStatus,
      total: accounts.length,
      active: accounts.filter(a => a.status === 'active').length
    });
    
  } catch (error) {
    logger.error('Error getting auth status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get authentication status'
    });
  }
});

module.exports = router;