const db = require('../config/database');
const logger = require('../utils/logger');
const GmailService = require('./gmailService');
const OutlookService = require('./outlookService');
const { encrypt, decrypt } = require('../utils/encryption');

class EmailService {
  constructor() {
    this.gmailService = new GmailService();
    this.outlookService = new OutlookService();
  }

  /**
   * Create or update email account
   */
  async createOrUpdateAccount(accountData) {
    try {
      const {
        email_address,
        provider,
        display_name,
        access_token,
        refresh_token,
        token_expires_at
      } = accountData;

      // Encrypt tokens before storing
      const encryptedAccessToken = encrypt(access_token);
      const encryptedRefreshToken = refresh_token ? encrypt(refresh_token) : null;

      const query = `
        INSERT INTO email_accounts (
          email_address, provider, display_name, access_token, 
          refresh_token, token_expires_at, status, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW())
        ON CONFLICT (email_address) 
        DO UPDATE SET 
          provider = EXCLUDED.provider,
          display_name = EXCLUDED.display_name,
          access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          token_expires_at = EXCLUDED.token_expires_at,
          status = 'active',
          updated_at = NOW()
        RETURNING *
      `;

      const result = await db.query(query, [
        email_address,
        provider,
        display_name,
        encryptedAccessToken,
        encryptedRefreshToken,
        token_expires_at
      ]);

      logger.info(`Email account ${email_address} created/updated successfully`);
      return result.rows[0];

    } catch (error) {
      logger.error('Error creating/updating email account:', error);
      throw error;
    }
  }

  /**
   * Get email account by ID
   */
  async getAccount(accountId) {
    try {
      const query = 'SELECT * FROM email_accounts WHERE id = $1';
      const result = await db.query(query, [accountId]);
      
      if (result.rows.length === 0) {
        throw new Error('Account not found');
      }

      const account = result.rows[0];
      
      // Decrypt tokens
      if (account.access_token) {
        account.access_token = decrypt(account.access_token);
      }
      if (account.refresh_token) {
        account.refresh_token = decrypt(account.refresh_token);
      }

      return account;
    } catch (error) {
      logger.error(`Error getting account ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Get all email accounts
   */
  async getAllAccounts() {
    try {
      const query = `
        SELECT id, email_address, provider, display_name, status, 
               last_sync_at, created_at, updated_at
        FROM email_accounts 
        ORDER BY created_at DESC
      `;
      const result = await db.query(query);
      return result.rows;
    } catch (error) {
      logger.error('Error getting all accounts:', error);
      throw error;
    }
  }

  /**
   * Update account status
   */
  async updateAccountStatus(accountId, status, errorMessage = null) {
    try {
      const query = `
        UPDATE email_accounts 
        SET status = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `;
      
      const result = await db.query(query, [status, accountId]);
      
      if (errorMessage) {
        logger.error(`Account ${accountId} status updated to ${status}: ${errorMessage}`);
      } else {
        logger.info(`Account ${accountId} status updated to ${status}`);
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error(`Error updating account status for ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Refresh access token for account
   */
  async refreshAccountToken(accountId) {
    try {
      const account = await this.getAccount(accountId);
      
      if (!account.refresh_token) {
        throw new Error('No refresh token available');
      }

      let newTokens;
      
      if (account.provider === 'gmail') {
        newTokens = await this.gmailService.refreshAccessToken(account.refresh_token);
      } else if (account.provider === 'outlook') {
        newTokens = await this.outlookService.refreshAccessToken(account.refresh_token);
      } else {
        throw new Error(`Unsupported provider: ${account.provider}`);
      }

      // Update tokens in database
      const expiresAt = new Date(Date.now() + (newTokens.expires_in * 1000));
      
      const query = `
        UPDATE email_accounts 
        SET access_token = $1, refresh_token = $2, token_expires_at = $3, 
            status = 'active', updated_at = NOW()
        WHERE id = $4
        RETURNING *
      `;

      const result = await db.query(query, [
        encrypt(newTokens.access_token),
        newTokens.refresh_token ? encrypt(newTokens.refresh_token) : account.refresh_token,
        expiresAt,
        accountId
      ]);

      logger.info(`Tokens refreshed for account ${accountId}`);
      return result.rows[0];

    } catch (error) {
      logger.error(`Error refreshing tokens for account ${accountId}:`, error);
      await this.updateAccountStatus(accountId, 'error', error.message);
      throw error;
    }
  }

  /**
   * Store emails in database
   */
  async storeEmails(accountId, emails) {
    try {
      if (!emails || emails.length === 0) {
        return { stored: 0, skipped: 0 };
      }

      let stored = 0;
      let skipped = 0;

      for (const email of emails) {
        try {
          const query = `
            INSERT INTO emails (
              account_id, message_id, thread_id, subject, body_text, body_html,
              sender_email, sender_name, recipient_emails, cc_emails, bcc_emails,
              received_at, sent_at, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
            ON CONFLICT (account_id, message_id) DO NOTHING
            RETURNING id
          `;

          // Parse sender information
          const senderMatch = email.from.match(/^(.*?)\s*<(.+)>$/) || [null, email.from, email.from];
          const senderName = senderMatch[1]?.trim() || '';
          const senderEmail = senderMatch[2]?.trim() || email.from;

          // Parse recipient arrays
          const recipientEmails = email.to ? email.to.split(',').map(e => e.trim()) : [];
          const ccEmails = email.cc ? email.cc.split(',').map(e => e.trim()) : [];
          const bccEmails = email.bcc ? email.bcc.split(',').map(e => e.trim()) : [];

          const result = await db.query(query, [
            accountId,
            email.id,
            email.threadId || email.id,
            email.subject || '',
            email.bodyText || '',
            email.bodyHtml || '',
            senderEmail,
            senderName,
            recipientEmails,
            ccEmails,
            bccEmails,
            email.receivedDateTime || email.internalDate || new Date(),
            email.sentDateTime || email.internalDate || new Date()
          ]);

          if (result.rows.length > 0) {
            stored++;
          } else {
            skipped++;
          }

        } catch (emailError) {
          logger.warn(`Error storing email ${email.id}:`, emailError);
          skipped++;
        }
      }

      logger.info(`Stored ${stored} emails, skipped ${skipped} duplicates for account ${accountId}`);
      return { stored, skipped };

    } catch (error) {
      logger.error(`Error storing emails for account ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Sync emails for a specific account
   */
  async syncAccount(accountId, options = {}) {
    try {
      logger.info(`Starting email sync for account ${accountId}`);
      
      const account = await this.getAccount(accountId);
      
      // Check if token needs refresh
      if (account.token_expires_at && new Date(account.token_expires_at) <= new Date()) {
        logger.info(`Token expired for account ${accountId}, refreshing...`);
        await this.refreshAccountToken(accountId);
        // Get updated account with new tokens
        const updatedAccount = await this.getAccount(accountId);
        account.access_token = updatedAccount.access_token;
      }

      // Determine sync options
      const syncOptions = {
        maxEmails: options.maxEmails || parseInt(process.env.MAX_EMAILS_PER_SYNC) || 1000,
        sinceDate: options.sinceDate || account.last_sync_at
      };

      let syncResult;

      // Sync based on provider
      if (account.provider === 'gmail') {
        this.gmailService.setCredentials({
          access_token: account.access_token,
          refresh_token: account.refresh_token
        });
        syncResult = await this.gmailService.syncEmails(accountId, syncOptions);
      } else if (account.provider === 'outlook') {
        syncResult = await this.outlookService.syncEmails(account.access_token, accountId, syncOptions);
      } else {
        throw new Error(`Unsupported provider: ${account.provider}`);
      }

      // Store emails in database
      if (syncResult.messages && syncResult.messages.length > 0) {
        const storeResult = await this.storeEmails(accountId, syncResult.messages);
        syncResult.stored = storeResult.stored;
        syncResult.skipped = storeResult.skipped;
      }

      // Update last sync time
      await db.query(
        'UPDATE email_accounts SET last_sync_at = NOW(), status = $1 WHERE id = $2',
        ['active', accountId]
      );

      logger.info(`Email sync completed for account ${accountId}:`, syncResult);
      return syncResult;

    } catch (error) {
      logger.error(`Email sync failed for account ${accountId}:`, error);
      await this.updateAccountStatus(accountId, 'error', error.message);
      throw error;
    }
  }

  /**
   * Sync all active accounts
   */
  async syncAllAccounts(options = {}) {
    try {
      const query = `
        SELECT id FROM email_accounts 
        WHERE status = 'active' 
        ORDER BY last_sync_at ASC NULLS FIRST
      `;
      
      const result = await db.query(query);
      const accounts = result.rows;

      logger.info(`Starting sync for ${accounts.length} accounts`);

      const results = [];
      
      for (const account of accounts) {
        try {
          const syncResult = await this.syncAccount(account.id, options);
          results.push({
            accountId: account.id,
            success: true,
            ...syncResult
          });
        } catch (error) {
          results.push({
            accountId: account.id,
            success: false,
            error: error.message
          });
        }
      }

      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      logger.info(`Sync completed: ${successful} successful, ${failed} failed`);
      
      return {
        total: accounts.length,
        successful,
        failed,
        results
      };

    } catch (error) {
      logger.error('Error syncing all accounts:', error);
      throw error;
    }
  }

  /**
   * Get emails for processing
   */
  async getEmailsForProcessing(limit = 100, offset = 0) {
    try {
      const query = `
        SELECT e.*, ea.email_address, ea.provider
        FROM emails e
        JOIN email_accounts ea ON e.account_id = ea.id
        WHERE e.is_processed = false
        ORDER BY e.received_at DESC
        LIMIT $1 OFFSET $2
      `;

      const result = await db.query(query, [limit, offset]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting emails for processing:', error);
      throw error;
    }
  }

  /**
   * Mark email as processed
   */
  async markEmailProcessed(emailId, status = 'completed', error = null) {
    try {
      const query = `
        UPDATE emails 
        SET is_processed = $1, processing_status = $2, processing_error = $3, updated_at = NOW()
        WHERE id = $4
        RETURNING *
      `;

      const result = await db.query(query, [
        status === 'completed',
        status,
        error,
        emailId
      ]);

      return result.rows[0];
    } catch (error) {
      logger.error(`Error marking email ${emailId} as processed:`, error);
      throw error;
    }
  }

  /**
   * Get account statistics
   */
  async getAccountStats(accountId) {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_emails,
          COUNT(*) FILTER (WHERE is_processed = true) as processed_emails,
          COUNT(*) FILTER (WHERE is_processed = false) as pending_emails,
          MAX(received_at) as latest_email,
          MIN(received_at) as oldest_email
        FROM emails 
        WHERE account_id = $1
      `;

      const result = await db.query(query, [accountId]);
      return result.rows[0];
    } catch (error) {
      logger.error(`Error getting stats for account ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Delete account and all associated data
   */
  async deleteAccount(accountId) {
    try {
      await db.transaction(async (client) => {
        // Delete questions first (due to foreign key constraints)
        await client.query('DELETE FROM questions WHERE email_id IN (SELECT id FROM emails WHERE account_id = $1)', [accountId]);
        
        // Delete emails
        await client.query('DELETE FROM emails WHERE account_id = $1', [accountId]);
        
        // Delete processing jobs
        await client.query('DELETE FROM processing_jobs WHERE account_id = $1', [accountId]);
        
        // Delete account
        await client.query('DELETE FROM email_accounts WHERE id = $1', [accountId]);
      });

      logger.info(`Account ${accountId} and all associated data deleted`);
    } catch (error) {
      logger.error(`Error deleting account ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Test account connection
   */
  async testAccountConnection(accountId) {
    try {
      const account = await this.getAccount(accountId);
      
      let testResult;
      
      if (account.provider === 'gmail') {
        this.gmailService.setCredentials({
          access_token: account.access_token,
          refresh_token: account.refresh_token
        });
        testResult = await this.gmailService.testConnection();
      } else if (account.provider === 'outlook') {
        testResult = await this.outlookService.testConnection(account.access_token);
      } else {
        throw new Error(`Unsupported provider: ${account.provider}`);
      }

      // Update account status based on test result
      if (testResult.success) {
        await this.updateAccountStatus(accountId, 'active');
      } else {
        await this.updateAccountStatus(accountId, 'error', testResult.error);
      }

      return testResult;
    } catch (error) {
      logger.error(`Connection test failed for account ${accountId}:`, error);
      await this.updateAccountStatus(accountId, 'error', error.message);
      throw error;
    }
  }
}

module.exports = EmailService;