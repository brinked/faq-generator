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
      const columnCheck = await db.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'emails' 
        AND column_name = 'processed_for_faq'
      `);
      
      let query;
      if (columnCheck.rows.length > 0) {
        query = `
          SELECT 
            e.id, e.account_id, e.message_id, e.thread_id, e.subject,
            e.body_text, e.sender_email, e.sender_name, e.received_at,
            ea.email_address as account_email, ea.provider
          FROM emails e
          JOIN email_accounts ea ON e.account_id = ea.id
          WHERE e.processed_for_faq = false
            AND e.body_text IS NOT NULL
            AND LENGTH(e.body_text) > 50
          ORDER BY e.received_at DESC
          LIMIT $1 OFFSET $2
        `;
      } else {
        logger.warn('Column processed_for_faq does not exist, using fallback query');
        query = `
          SELECT 
            e.id, e.account_id, e.message_id, e.thread_id, e.subject,
            e.body_text, e.sender_email, e.sender_name, e.received_at,
            ea.email_address as account_email, ea.provider
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
   * Get account(s) by ID or all accounts
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
    const gmailService = new (require('./gmailService'))();
    gmailService.setCredentials({
      access_token: account.access_token,
      refresh_token: account.refresh_token,
      expiry_date: account.token_expires_at
    });

    try {
      const syncResult = await gmailService.syncEmails(account.id, { maxEmails });
      
      if (syncResult.messages && syncResult.messages.length > 0) {
        await this.saveEmails(account.id, syncResult.messages);
      }
      
      return { synced: syncResult.processed };
    } catch (error) {
      if (error.originalError?.response?.data?.error === 'invalid_grant') {
        logger.warn(`Account ${account.id} has an invalid grant. Attempting token refresh.`);
        
        try {
          // Attempt to refresh the token
          const newCredentials = await gmailService.refreshAccessToken(account.refresh_token);
          
          if (newCredentials && newCredentials.access_token) {
            logger.info(`Successfully refreshed token for account ${account.id}`);
            
            // Update the account with new credentials
            await this.updateAccountTokens(account.id, {
              access_token: newCredentials.access_token,
              refresh_token: newCredentials.refresh_token || account.refresh_token,
              token_expires_at: newCredentials.expiry_date
            });
            
            // Set the new credentials and retry the sync
            gmailService.setCredentials(newCredentials);
            const syncResult = await gmailService.syncEmails(account.id, { maxEmails });
            
            if (syncResult.messages && syncResult.messages.length > 0) {
              await this.saveEmails(account.id, syncResult.messages);
            }
            
            return { synced: syncResult.processed };
          } else {
            throw new Error('Token refresh returned invalid credentials');
          }
        } catch (refreshError) {
          logger.error(`Failed to refresh token for account ${account.id}:`, refreshError);
          await this.updateAccountStatus(account.id, 'expired');
          throw new Error('Account token has expired and could not be refreshed. Please reconnect the account.');
        }
      }
      throw error;
    }
  }

  /**
   * Sync Outlook account
   */
  async syncOutlookAccount(account, maxEmails) {
    logger.info('Outlook sync not implemented in this version');
    return { synced: 0 };
  }

  /**
   * Refresh account token
   */
  async refreshAccountToken(accountId) {
    try {
      const account = await this.getAccountById(accountId);
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

  /**
   * Save emails to the database
   */
  async saveEmails(accountId, emails) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      
      for (const email of emails) {
        const query = `
          INSERT INTO emails (account_id, message_id, thread_id, subject, body_text, sender_email, sender_name, received_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (message_id) DO NOTHING
        `;
        await client.query(query, [
          accountId, email.id, email.threadId, email.subject,
          email.bodyText, email.from, email.from, email.internalDate
        ]);
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error saving emails:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get statistics for a single account
   */
  async getAccountStats(accountId) {
    const statsQuery = `
      SELECT
        COUNT(*) AS total_emails,
        COUNT(*) FILTER (WHERE is_processed = true) AS processed_emails,
        COUNT(*) FILTER (WHERE is_processed = false) AS pending_emails,
        MAX(received_at) AS latest_email,
        MIN(received_at) AS oldest_email
      FROM emails
      WHERE account_id = $1
    `;
    const result = await db.query(statsQuery, [accountId]);
    return result.rows[0];
  }

  /**
   * Update the status of an account
   */
  async updateAccountStatus(accountId, status) {
    const query = `
      UPDATE email_accounts
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    const result = await db.query(query, [status, accountId]);
    return result.rows[0];
  }

  /**
   * Update account tokens after refresh
   */
  async updateAccountTokens(accountId, tokens) {
    try {
      const encryptedAccessToken = encrypt(tokens.access_token);
      const encryptedRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;
      
      const query = `
        UPDATE email_accounts
        SET
          access_token = $1,
          refresh_token = COALESCE($2, refresh_token),
          token_expires_at = $3,
          status = 'active',
          updated_at = NOW()
        WHERE id = $4
        RETURNING id, email_address, provider, status
      `;
      
      const result = await db.query(query, [
        encryptedAccessToken,
        encryptedRefreshToken,
        tokens.token_expires_at ? new Date(tokens.token_expires_at) : null,
        accountId
      ]);
      
      if (result.rows.length === 0) {
        throw new Error(`Account ${accountId} not found`);
      }
      
      logger.info(`Updated tokens for account ${accountId}`, {
        accountId,
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiresAt: tokens.token_expires_at
      });
      
      return result.rows[0];
    } catch (error) {
      logger.error(`Error updating tokens for account ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Delete an email account and all associated data
   */
  async deleteAccount(accountId) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      
      logger.info(`Starting deletion of account ${accountId}`);
      
      // First, delete all questions associated with emails from this account
      const deleteQuestionsQuery = `
        DELETE FROM questions
        WHERE email_id IN (
          SELECT id FROM emails WHERE account_id = $1
        )
      `;
      const questionsResult = await client.query(deleteQuestionsQuery, [accountId]);
      logger.info(`Deleted ${questionsResult.rowCount} questions for account ${accountId}`);
      
      // Then, delete all emails associated with this account
      const deleteEmailsQuery = 'DELETE FROM emails WHERE account_id = $1';
      const emailsResult = await client.query(deleteEmailsQuery, [accountId]);
      logger.info(`Deleted ${emailsResult.rowCount} emails for account ${accountId}`);
      
      // Finally, delete the account itself
      const deleteAccountQuery = 'DELETE FROM email_accounts WHERE id = $1 RETURNING email_address, provider';
      const accountResult = await client.query(deleteAccountQuery, [accountId]);
      
      if (accountResult.rows.length === 0) {
        throw new Error(`Account ${accountId} not found`);
      }
      
      const deletedAccount = accountResult.rows[0];
      logger.info(`Successfully deleted account ${accountId}`, {
        email: deletedAccount.email_address,
        provider: deletedAccount.provider
      });
      
      await client.query('COMMIT');
      
      return {
        success: true,
        message: `Account ${deletedAccount.email_address} and all associated data deleted successfully`,
        deletedEmails: emailsResult.rowCount,
        deletedQuestions: questionsResult.rowCount
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`Error deleting account ${accountId}:`, error);
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = EmailService;