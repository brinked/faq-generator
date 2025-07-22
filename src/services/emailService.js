const { google } = require('googleapis');
const db = require('../config/database');
const logger = require('../utils/logger');
const { encrypt, decrypt } = require('../utils/encryption');

class EmailService {
  constructor() {
    this.gmail = null;
  }

  /**
   * Get emails for processing with safe column handling
   */
  async getEmailsForProcessing(limit = 100, offset = 0) {
    try {
      // First check if the column exists
      const columnCheck = await db.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'emails' 
        AND column_name = 'processed_for_faq'
      `);
      
      let query;
      if (columnCheck.rows.length > 0) {
        // Column exists, use it
        query = `
          SELECT 
            e.id,
            e.account_id,
            e.message_id,
            e.thread_id,
            e.subject,
            e.body_text,
            e.sender_email,
            e.sender_name,
            e.received_at,
            ea.email_address as account_email,
            ea.provider
          FROM emails e
          JOIN email_accounts ea ON e.account_id = ea.id
          WHERE e.processed_for_faq = false
            AND e.body_text IS NOT NULL
            AND LENGTH(e.body_text) > 50
          ORDER BY e.received_at DESC
          LIMIT $1 OFFSET $2
        `;
      } else {
        // Column doesn't exist, use alternative query
        logger.warn('Column processed_for_faq does not exist, using fallback query');
        query = `
          SELECT 
            e.id,
            e.account_id,
            e.message_id,
            e.thread_id,
            e.subject,
            e.body_text,
            e.sender_email,
            e.sender_name,
            e.received_at,
            ea.email_address as account_email,
            ea.provider
          FROM emails e
          JOIN email_accounts ea ON e.account_id = ea.id
          WHERE e.body_text IS NOT NULL
            AND LENGTH(e.body_text) > 50
            AND NOT EXISTS (
              SELECT 1 FROM questions q 
              WHERE q.email_id = e.id
            )
          ORDER BY e.received_at DESC
          LIMIT $1 OFFSET $2
        `;
      }
      
      const result = await db.query(query, [limit, offset]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting emails for processing:', error);
      throw error;
    }
  }

  /**
   * Get account by ID
   */
  async getAccounts(accountId = null) {
    try {
      let query = 'SELECT * FROM email_accounts';
      const params = [];
      
      if (accountId) {
        query += ' WHERE id = $1';
        params.push(accountId);
      }
      
      const result = await db.query(query, params);
      
      if (accountId && result.rows.length === 0) {
        throw new Error('Account not found');
      }
      
      return accountId ? result.rows[0] : result.rows;
    } catch (error) {
      logger.error('Error getting account(s):', error);
      throw error;
    }
  }

  /**
   * Sync emails for a specific account
   */
  async syncAccount(accountId, options = {}) {
    const { maxEmails = 100 } = options;
    
    try {
      const account = await this.getAccountById(accountId);
      
      if (account.provider === 'gmail') {
        return await this.syncGmailAccount(account, maxEmails);
      } else if (account.provider === 'outlook') {
        return await this.syncOutlookAccount(account, maxEmails);
      } else {
        throw new Error(`Unsupported provider: ${account.provider}`);
      }
    } catch (error) {
      logger.error('Error syncing account:', error);
      throw error;
    }
  }

  /**
   * Sync Gmail account
   */
  async syncGmailAccount(account, maxEmails) {
    // Implementation would go here
    logger.info('Gmail sync not implemented in this version');
    return { synced: 0 };
  }

  /**
   * Sync Outlook account
   */
  async syncOutlookAccount(account, maxEmails) {
    // Implementation would go here
    logger.info('Outlook sync not implemented in this version');
    return { synced: 0 };
  }

  /**
   * Refresh account token
   */
  async refreshAccountToken(accountId) {
    try {
      const account = await this.getAccountById(accountId);
      
      // Token refresh logic would go here
      logger.info('Token refresh not implemented in this version');
      
      return account;
    } catch (error) {
      logger.error('Error refreshing token:', error);
      throw error;
    }
  }

  /**
   * Create or update email account
   */
  async createOrUpdateAccount(accountData) {
    try {
      const { email, provider, accessToken, refreshToken, expiresAt, displayName } = accountData;
      
      const result = await db.query(
        `INSERT INTO email_accounts
         (email_address, provider, access_token, refresh_token, token_expires_at, display_name, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'active')
         ON CONFLICT (email_address)
         DO UPDATE SET
           access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           token_expires_at = EXCLUDED.token_expires_at,
           display_name = EXCLUDED.display_name,
           status = 'active',
           updated_at = NOW()
         RETURNING *`,
        [email, provider, accessToken, refreshToken, expiresAt, displayName]
      );
      
      logger.info('Account created/updated successfully:', { email, provider });
      return result.rows[0];
      
    } catch (error) {
      logger.error('Error creating/updating account:', error);
      throw error;
    }
  }

  /**
   * Get a single account by its ID
   */
  async getAccountById(accountId) {
    return this.getAccounts(accountId);
  }
}

module.exports = EmailService;