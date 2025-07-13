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
const baseUrl = process.env.BASE_URL || "http://localhost:3000";
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
 * Get Gmail authorization URL
 */
router.get('/gmail/url', async (req, res) => {
  try {
    const authUrl = gmailService.getAuthUrl();
    
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
      return res.redirect(`${corsOrigin}/dashboard?error=oauth_denied`);
    }
    
    if (!code) {
      return res.redirect(`${corsOrigin}/dashboard?error=no_code`);
    }

    // Exchange code for tokens
    const tokens = await gmailService.getTokens(code);
    
    // Set credentials and get user profile
    gmailService.setCredentials(tokens);
    const profile = await gmailService.getUserProfile();
    
    // Create or update account
    const accountData = {
      email_address: profile.email,
      provider: 'gmail',
      display_name: profile.name,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(Date.now() + (tokens.expires_in * 1000))
    };
    
    const account = await emailService.createOrUpdateAccount(accountData);
    
    logger.info(`Gmail account connected: ${profile.email}`);
    
    res.redirect(`${corsOrigin}/dashboard?success=gmail_connected&account=${account.id}`);
    
  } catch (error) {
    logger.error('Gmail callback error:', error);
    res.redirect(`${corsOrigin}/dashboard?error=connection_failed`);
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
    
    if (error) {
      logger.error('Outlook OAuth error:', error);
      return res.redirect(`${corsOrigin}/dashboard?error=oauth_denied`);
    }
    
    if (!code) {
      return res.redirect(`${corsOrigin}/dashboard?error=no_code`);
    }

    // Exchange code for tokens
    const tokens = await outlookService.getTokens(code);
    
    // Get user profile
    const profile = await outlookService.getUserProfile(tokens.access_token);
    
    // Create or update account
    const accountData = {
      email_address: profile.mail || profile.userPrincipalName,
      provider: 'outlook',
      display_name: profile.displayName,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(Date.now() + (tokens.expires_in * 1000))
    };
    
    const account = await emailService.createOrUpdateAccount(accountData);
    
    logger.info(`Outlook account connected: ${profile.mail || profile.userPrincipalName}`);
    
    res.redirect(`${corsOrigin}/dashboard?success=outlook_connected&account=${account.id}`);
    
  } catch (error) {
    logger.error('Outlook callback error:', error);
    res.redirect(`${corsOrigin}/dashboard?error=connection_failed`);
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