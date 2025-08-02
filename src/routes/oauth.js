const express = require('express');
const router = express.Router();
const db = require('../config/database');
const logger = require('../utils/logger');
const { encrypt } = require('../utils/encryption');
const GmailService = require('../services/gmailService');
const OutlookService = require('../services/outlookService');

/**
 * Get Gmail OAuth authorization URL
 * GET /api/auth/gmail/url
 */
router.get('/gmail/url', async (req, res) => {
  try {
    const gmailService = new GmailService();
    const authUrl = gmailService.getAuthUrl();
    
    res.json({
      success: true,
      authUrl: authUrl
    });
  } catch (error) {
    logger.error('Error generating Gmail auth URL:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate Gmail authorization URL'
    });
  }
});

/**
 * Get Outlook OAuth authorization URL
 * GET /api/auth/outlook/url
 */
router.get('/outlook/url', async (req, res) => {
  try {
    const outlookService = new OutlookService();
    const authUrl = await outlookService.getAuthUrl();
    
    res.json({
      success: true,
      authUrl: authUrl
    });
  } catch (error) {
    logger.error('Error generating Outlook auth URL:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate Outlook authorization URL'
    });
  }
});

/**
 * Handle Gmail OAuth callback
 * GET /api/auth/gmail/callback
 */
router.get('/gmail/callback', async (req, res) => {
  console.log('🔥 Gmail callback hit! Query:', req.query);
  try {
    const { code, error } = req.query;
    
    if (error) {
      logger.error('Gmail OAuth error:', error);
      return res.redirect(`${process.env.CORS_ORIGIN || 'http://localhost:3001'}/oauth-success.html?error=oauth_error&message=${encodeURIComponent(error)}`);
    }
    
    if (!code) {
      logger.error('No authorization code received from Gmail');
      return res.redirect(`${process.env.CORS_ORIGIN || 'http://localhost:3001'}/oauth-success.html?error=no_code&message=${encodeURIComponent('No authorization code received')}`);
    }
    
    const gmailService = new GmailService();
    const tokens = await gmailService.getTokens(code);
    
    // Get user info
    gmailService.setCredentials(tokens);
    const userInfo = await gmailService.getUserProfile();
    
    // Check if account already exists
    const existingAccount = await db.query(
      'SELECT id FROM email_accounts WHERE email_address = $1',
      [userInfo.email]
    );
    
    let accountId;
    if (existingAccount.rows.length > 0) {
      // Update existing account
      accountId = existingAccount.rows[0].id;
      await db.query(`
        UPDATE email_accounts 
        SET access_token = $1, refresh_token = $2, token_expires_at = $3, 
            status = 'active', last_sync_at = NULL, sync_cursor = NULL, updated_at = NOW()
        WHERE id = $4
      `, [
        encrypt(tokens.access_token),
        encrypt(tokens.refresh_token),
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        accountId
      ]);
    } else {
      // Create new account
      const result = await db.query(`
        INSERT INTO email_accounts (
          email_address, provider, display_name, access_token, refresh_token, 
          token_expires_at, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7) 
        RETURNING id
      `, [
        userInfo.email,
        'gmail',
        userInfo.name || userInfo.email,
        encrypt(tokens.access_token),
        encrypt(tokens.refresh_token),
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        'active'
      ]);
      accountId = result.rows[0].id;
    }
    
    logger.info('Gmail account connected successfully:', {
      accountId,
      email: userInfo.email,
      hasRefreshToken: !!tokens.refresh_token
    });
    
    // Redirect to OAuth success page
    res.redirect(`${process.env.CORS_ORIGIN || 'http://localhost:3001'}/oauth-success.html?success=true&provider=gmail&email=${encodeURIComponent(userInfo.email)}&accountId=${accountId}`);
    
  } catch (error) {
    logger.error('Error handling Gmail OAuth callback:', error);
    res.redirect(`${process.env.CORS_ORIGIN || 'http://localhost:3001'}/oauth-success.html?error=callback_failed&message=${encodeURIComponent(error.message)}`);
  }
});

/**
 * Handle Outlook OAuth callback
 * GET /api/auth/outlook/callback
 */
router.get('/outlook/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    
    if (error) {
      logger.error('Outlook OAuth error:', error);
      return res.redirect(`${process.env.CORS_ORIGIN || 'http://localhost:3001'}/oauth-success.html?error=oauth_error&message=${encodeURIComponent(error)}`);
    }
    
    if (!code) {
      logger.error('No authorization code received from Outlook');
      return res.redirect(`${process.env.CORS_ORIGIN || 'http://localhost:3001'}/oauth-success.html?error=no_code&message=${encodeURIComponent('No authorization code received')}`);
    }
    
    const outlookService = new OutlookService();
    const tokens = await outlookService.getTokens(code);
    
    // Get user info
    outlookService.setCredentials(tokens);
    const userInfo = await outlookService.getUserProfile(tokens.access_token);
    
    // Check if account already exists
    const existingAccount = await db.query(
      'SELECT id FROM email_accounts WHERE email_address = $1',
      [userInfo.email]
    );
    
    let accountId;
    if (existingAccount.rows.length > 0) {
      // Update existing account
      accountId = existingAccount.rows[0].id;
      await db.query(`
        UPDATE email_accounts 
        SET access_token = $1, refresh_token = $2, token_expires_at = $3, 
            status = 'active', last_sync_at = NULL, sync_cursor = NULL, updated_at = NOW()
        WHERE id = $4
      `, [
        encrypt(tokens.access_token),
        encrypt(tokens.refresh_token),
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        accountId
      ]);
    } else {
      // Create new account
      const result = await db.query(`
        INSERT INTO email_accounts (
          email_address, provider, display_name, access_token, refresh_token, 
          token_expires_at, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7) 
        RETURNING id
      `, [
        userInfo.email,
        'outlook',
        userInfo.name || userInfo.email,
        encrypt(tokens.access_token),
        encrypt(tokens.refresh_token),
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        'active'
      ]);
      accountId = result.rows[0].id;
    }
    
    logger.info('Outlook account connected successfully:', {
      accountId,
      email: userInfo.email,
      hasRefreshToken: !!tokens.refresh_token
    });
    
    // Redirect to OAuth success page
    res.redirect(`${process.env.CORS_ORIGIN || 'http://localhost:3001'}/oauth-success.html?success=true&provider=outlook&email=${encodeURIComponent(userInfo.email)}&accountId=${accountId}`);
    
  } catch (error) {
    logger.error('Error handling Outlook OAuth callback:', error);
    res.redirect(`${process.env.CORS_ORIGIN || 'http://localhost:3001'}/oauth-success.html?error=callback_failed&message=${encodeURIComponent(error.message)}`);
  }
});

module.exports = router; 