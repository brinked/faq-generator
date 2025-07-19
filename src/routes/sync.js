const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const EmailService = require('../services/emailService');

const emailService = new EmailService();

/**
 * Get sync status and statistics
 */
router.get('/status', async (req, res) => {
  try {
    const db = require('../config/database');
    
    // Get all accounts with sync status
    const accountsQuery = `
      SELECT 
        id, email_address, provider, status, last_sync_at, created_at,
        (
          SELECT COUNT(*) FROM emails 
          WHERE account_id = email_accounts.id
        ) as total_emails,
        (
          SELECT COUNT(*) FROM emails 
          WHERE account_id = email_accounts.id AND is_processed = false
        ) as pending_emails
      FROM email_accounts 
      ORDER BY created_at DESC
    `;
    
    const accountsResult = await db.query(accountsQuery);
    
    // Get recent sync metrics
    const metricsQuery = `
      SELECT metric_name, metric_value, metadata, created_at
      FROM system_metrics 
      WHERE metric_name LIKE '%email%' OR metric_name LIKE '%sync%'
      ORDER BY created_at DESC 
      LIMIT 10
    `;
    
    const metricsResult = await db.query(metricsQuery);
    
    // Calculate overall statistics
    const totalAccounts = accountsResult.rows.length;
    const activeAccounts = accountsResult.rows.filter(a => a.status === 'active').length;
    const totalEmails = accountsResult.rows.reduce((sum, a) => sum + parseInt(a.total_emails), 0);
    const pendingEmails = accountsResult.rows.reduce((sum, a) => sum + parseInt(a.pending_emails), 0);
    
    res.json({
      success: true,
      status: {
        total_accounts: totalAccounts,
        active_accounts: activeAccounts,
        total_emails: totalEmails,
        pending_emails: pendingEmails,
        last_sync: accountsResult.rows.length > 0 ? 
          Math.max(...accountsResult.rows.map(a => new Date(a.last_sync_at || 0).getTime())) : null
      },
      accounts: accountsResult.rows,
      recent_metrics: metricsResult.rows
    });
    
  } catch (error) {
    logger.error('Error getting sync status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sync status'
    });
  }
});

/**
 * Trigger manual sync for all accounts
 */
router.post('/trigger', async (req, res) => {
  try {
    const { maxEmails = 100 } = req.body;
    
    logger.info('Manual sync triggered via API', { maxEmails });
    
    // Start sync in background
    const syncPromise = emailService.syncAllAccounts({ maxEmails });
    
    // Don't wait for completion, return immediately
    res.json({
      success: true,
      message: 'Email sync started',
      maxEmails,
      note: 'Sync is running in background. Check /api/sync/status for progress.'
    });
    
    // Handle sync completion/failure in background
    syncPromise
      .then(result => {
        logger.info('Manual sync completed via API', result);
      })
      .catch(error => {
        logger.error('Manual sync failed via API', error);
      });
    
  } catch (error) {
    logger.error('Error triggering manual sync:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to trigger sync'
    });
  }
});

/**
 * Trigger sync for specific account
 */
router.post('/trigger/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { maxEmails = 100 } = req.body;
    
    logger.info('Manual account sync triggered via API', { accountId, maxEmails });
    
    // Get account info first
    const account = await emailService.getAccount(accountId);
    
    // Start sync in background
    const syncPromise = emailService.syncAccount(accountId, { maxEmails });
    
    // Don't wait for completion, return immediately
    res.json({
      success: true,
      message: `Email sync started for ${account.email_address}`,
      accountId,
      maxEmails,
      note: 'Sync is running in background. Check /api/sync/status for progress.'
    });
    
    // Handle sync completion/failure in background
    syncPromise
      .then(result => {
        logger.info('Manual account sync completed via API', { accountId, result });
      })
      .catch(error => {
        logger.error('Manual account sync failed via API', { accountId, error: error.message });
      });
    
  } catch (error) {
    logger.error('Error triggering account sync:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to trigger account sync'
    });
  }
});

/**
 * Test account connection
 */
router.post('/test/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    
    logger.info('Testing account connection via API', { accountId });
    
    const testResult = await emailService.testAccountConnection(accountId);
    
    res.json({
      success: true,
      accountId,
      connectionTest: testResult
    });
    
  } catch (error) {
    logger.error('Error testing account connection:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to test connection'
    });
  }
});

/**
 * Get sync history/logs
 */
router.get('/history', async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    
    const db = require('../config/database');
    
    const query = `
      SELECT 
        metric_name, metric_value, metadata, created_at
      FROM system_metrics 
      WHERE metric_name LIKE '%sync%' OR metric_name LIKE '%email%'
      ORDER BY created_at DESC 
      LIMIT $1 OFFSET $2
    `;
    
    const result = await db.query(query, [parseInt(limit), parseInt(offset)]);
    
    // Parse metadata for better display
    const history = result.rows.map(row => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null
    }));
    
    res.json({
      success: true,
      history,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        count: result.rows.length
      }
    });
    
  } catch (error) {
    logger.error('Error getting sync history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sync history'
    });
  }
});

/**
 * Force refresh account tokens
 */
router.post('/refresh/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    
    logger.info('Refreshing account tokens via API', { accountId });
    
    const account = await emailService.refreshAccountToken(accountId);
    
    res.json({
      success: true,
      message: `Tokens refreshed for ${account.email_address}`,
      accountId,
      tokenExpiresAt: account.token_expires_at
    });
    
  } catch (error) {
    logger.error('Error refreshing account tokens:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to refresh tokens'
    });
  }
});

module.exports = router;