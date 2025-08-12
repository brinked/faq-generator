const { google } = require('googleapis');
const db = require('../config/database');
const logger = require('../utils/logger');
const { encrypt, decrypt } = require('../utils/encryption');
const EmailFilteringService = require('./emailFilteringService');

class EmailService {
  constructor() {
    this.gmail = null;
    this.filteringService = new EmailFilteringService();
  }

  /**
   * Get emails for FAQ processing with simplified filtering
   */
  async getEmailsForProcessing(limit = 100, offset = 0) {
    try {
      // Get all connected accounts for filtering
      const connectedAccounts = await this.getAccounts();

      // Check which columns exist
      const columnCheck = await db.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'emails'
        AND column_name IN ('processed_for_faq', 'direction', 'filtering_status')
      `);

      const existingColumns = columnCheck.rows.map(row => row.column_name);
      const hasProcessedColumn = existingColumns.includes('processed_for_faq');
      const hasDirectionColumn = existingColumns.includes('direction');
      const hasFilteringStatusColumn = existingColumns.includes('filtering_status');

      let query;
      if (hasProcessedColumn) {
        // Simplified query - just get unprocessed emails with content
        query = `
          SELECT
            e.id, e.account_id, e.message_id, e.thread_id, e.subject,
            e.body_text, e.sender_email, e.sender_name, e.received_at,
            e.recipient_emails, e.cc_emails,
            ea.email_address as account_email, ea.provider
          FROM emails e
          JOIN email_accounts ea ON e.account_id = ea.id
          WHERE e.processed_for_faq = false 
            AND e.body_text IS NOT NULL 
            AND LENGTH(e.body_text) > 20
            AND e.sender_email IS NOT NULL
          ORDER BY e.received_at DESC
          LIMIT $1 OFFSET $2
        `;
      } else {
        logger.warn('Column processed_for_faq does not exist, using fallback query');

        // Fallback query - check if email already has questions
        query = `
          SELECT
            e.id, e.account_id, e.message_id, e.thread_id, e.subject,
            e.body_text, e.sender_email, e.sender_name, e.received_at,
            e.recipient_emails, e.cc_emails,
            ea.email_address as account_email, ea.provider
          FROM emails e
          JOIN email_accounts ea ON e.account_id = ea.id
          WHERE e.body_text IS NOT NULL 
            AND LENGTH(e.body_text) > 20
            AND e.sender_email IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.email_id = e.id)
          ORDER BY e.received_at DESC
          LIMIT $1 OFFSET $2
        `;
      }

      // Log which columns exist for debugging
      logger.info(`Email processing columns available: processed_for_faq=${hasProcessedColumn}, direction=${hasDirectionColumn}, filtering_status=${hasFilteringStatusColumn}`);

      const result = await db.query(query, [limit, offset]);
      const emails = result.rows;

      logger.info(`Found ${emails.length} emails for processing`);

      // Return emails directly without additional filtering for now
      // This allows the FAQ processing to handle the content analysis
      return emails;

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
   * Sync all active accounts
   */
  async syncAllAccounts(options = {}) {
    const { maxEmails = 100, skipRecentlyProcessed = false } = options;

    try {
      logger.info('Starting sync for all active accounts', { maxEmails, skipRecentlyProcessed });

      // Get all active accounts
      const accounts = await this.getAccounts();
      const activeAccounts = accounts.filter(acc => acc.status === 'active');

      logger.info(`Found ${activeAccounts.length} active accounts to sync`);

      const results = {
        accounts: [],
        totalSynced: 0,
        errors: []
      };

      // Sync each account
      for (const account of activeAccounts) {
        try {
          // Skip if recently synced and skipRecentlyProcessed is true
          if (skipRecentlyProcessed && account.last_sync_at) {
            const lastSync = new Date(account.last_sync_at);
            const hoursSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);

            if (hoursSinceSync < 1) {
              logger.info(`Skipping account ${account.id} - synced ${hoursSinceSync.toFixed(2)} hours ago`);
              results.accounts.push({
                accountId: account.id,
                email: account.email_address,
                status: 'skipped',
                reason: 'recently_synced'
              });
              continue;
            }
          }

          logger.info(`Syncing account ${account.id} (${account.email_address})`);
          const syncResult = await this.syncAccount(account.id, { maxEmails });

          results.accounts.push({
            accountId: account.id,
            email: account.email_address,
            status: 'success',
            synced: syncResult.synced || 0
          });

          results.totalSynced += (syncResult.synced || 0);

          // Update last sync time
          await db.query(
            'UPDATE email_accounts SET last_sync_at = NOW() WHERE id = $1',
            [account.id]
          );

        } catch (error) {
          logger.error(`Error syncing account ${account.id}:`, error);
          results.errors.push({
            accountId: account.id,
            email: account.email_address,
            error: error.message
          });
          results.accounts.push({
            accountId: account.id,
            email: account.email_address,
            status: 'error',
            error: error.message
          });
        }
      }

      logger.info('Completed sync for all accounts', {
        totalAccounts: activeAccounts.length,
        totalSynced: results.totalSynced,
        errors: results.errors.length
      });

      // After syncing all accounts, fix email directions and analyze responses
      if (results.totalSynced > 0) {
        try {
          logger.info('Running email direction fix and response analysis...');
          const fixStats = await this.fixEmailDirectionAndResponses();
          results.fixStats = fixStats;
          logger.info('Email direction fix completed', fixStats);
        } catch (error) {
          logger.error('Error running email direction fix:', error);
          results.fixError = error.message;
        }
      }

      return results;

    } catch (error) {
      logger.error('Error in syncAllAccounts:', error);
      throw error;
    }
  }

  /**
   * Sync Gmail account
   */
  async syncGmailAccount(account, maxEmails) {
    const gmailService = new (require('./gmailService'))();

    // Decrypt the tokens before using them
    const decryptedAccessToken = decrypt(account.access_token);
    const decryptedRefreshToken = decrypt(account.refresh_token);

    gmailService.setCredentials({
      access_token: decryptedAccessToken,
      refresh_token: decryptedRefreshToken,
      expiry_date: account.token_expires_at
    });

    try {
      const syncResult = await gmailService.syncEmails(account.id, { maxEmails });

      if (syncResult.messages && syncResult.messages.length > 0) {
        await this.saveEmails(account.id, syncResult.messages);
      }

      // Store the nextPageToken for future fetch more operations
      if (syncResult.nextPageToken) {
        await db.query(
          'UPDATE email_accounts SET sync_cursor = $1, updated_at = NOW() WHERE id = $2',
          [syncResult.nextPageToken, account.id]
        );
        logger.info(`Stored nextPageToken for account ${account.id}: ${syncResult.nextPageToken}`);
      }

      return { 
        synced: syncResult.processed,
        nextPageToken: syncResult.nextPageToken || null,
        hasMore: syncResult.hasMore || false
      };
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

            // Store the nextPageToken for future fetch more operations
            if (syncResult.nextPageToken) {
              await db.query(
                'UPDATE email_accounts SET sync_cursor = $1, updated_at = NOW() WHERE id = $2',
                [syncResult.nextPageToken, account.id]
              );
              logger.info(`Stored nextPageToken for account ${account.id}: ${syncResult.nextPageToken}`);
            }

            return { 
              synced: syncResult.processed,
              nextPageToken: syncResult.nextPageToken || null,
              hasMore: syncResult.hasMore || false
            };
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
      const {
        email_address,
        provider,
        access_token,
        refresh_token,
        token_expires_at,
        status = 'active'
      } = accountData;

      // Encrypt tokens
      const encryptedAccessToken = encrypt(access_token);
      const encryptedRefreshToken = encrypt(refresh_token);

      const query = `
        INSERT INTO email_accounts (email_address, provider, access_token, refresh_token, token_expires_at, status)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (email_address, provider) DO UPDATE
        SET access_token = $3, refresh_token = $4, token_expires_at = $5, status = $6, updated_at = NOW()
        RETURNING *
      `;

      const result = await db.query(query, [
        email_address,
        provider,
        encryptedAccessToken,
        encryptedRefreshToken,
        token_expires_at,
        status
      ]);

      return result.rows[0];
    } catch (error) {
      logger.error('Error creating/updating account:', error);
      throw error;
    }
  }

  /**
   * Get account by ID
   */
  async getAccountById(accountId) {
    return this.getAccounts(accountId);
  }

  /**
   * Save emails to the database with automatic direction detection
   */
  async saveEmails(accountId, emails) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Get the account email for direction detection
      const accountResult = await client.query(
        'SELECT email_address FROM email_accounts WHERE id = $1',
        [accountId]
      );
      const accountEmail = accountResult.rows[0]?.email_address?.toLowerCase();

      for (const email of emails) {
        // Determine email direction
        const senderEmail = email.from?.toLowerCase() || '';
        const direction = senderEmail.includes(accountEmail) ? 'outbound' : 'inbound';

        // Check if direction column exists
        const columnCheck = await client.query(`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'emails' AND column_name = 'direction'
        `);

        let query;
        let params;

        if (columnCheck.rows.length > 0) {
          // Include direction in insert
          query = `
            INSERT INTO emails (account_id, message_id, thread_id, subject, body_text, sender_email, sender_name, received_at, direction)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (account_id, message_id)
            DO UPDATE SET direction = EXCLUDED.direction
            WHERE emails.direction IS NULL
          `;
          params = [
            accountId, email.id, email.threadId, email.subject,
            email.bodyText, email.from, email.from, email.internalDate, direction
          ];
        } else {
          // Fallback without direction
          query = `
            INSERT INTO emails (account_id, message_id, thread_id, subject, body_text, sender_email, sender_name, received_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (account_id, message_id) DO NOTHING
          `;
          params = [
            accountId, email.id, email.threadId, email.subject,
            email.bodyText, email.from, email.from, email.internalDate
          ];
        }

        await client.query(query, params);
      }

      await client.query('COMMIT');

      // Note: Thread analysis is now done in fixEmailDirectionAndResponses
      // which is called after all accounts are synced

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error saving emails:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Analyze email threads to detect responses
   */
  async analyzeThreadsForResponses(client) {
    try {
      // Check if required columns exist
      const columnCheck = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'emails'
        AND column_name IN ('direction', 'has_response')
      `);

      if (columnCheck.rows.length < 2) {
        return; // Skip if columns don't exist
      }

      // Get threads with both inbound and outbound emails
      const threadsQuery = `
        SELECT DISTINCT thread_id
        FROM emails
        WHERE thread_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM emails e2
          WHERE e2.thread_id = emails.thread_id
          AND e2.direction = 'inbound'
        )
        AND EXISTS (
          SELECT 1 FROM emails e3
          WHERE e3.thread_id = emails.thread_id
          AND e3.direction = 'outbound'
        )
      `;

      const threads = await client.query(threadsQuery);

      // Mark inbound emails in these threads as having responses
      if (threads.rows.length > 0) {
        const threadIds = threads.rows.map(t => t.thread_id);
        await client.query(`
          UPDATE emails
          SET has_response = true
          WHERE thread_id = ANY($1::text[])
          AND direction = 'inbound'
          AND (has_response IS NULL OR has_response = false)
        `, [threadIds]);
      }

    } catch (error) {
      logger.error('Error analyzing threads for responses:', error);
      // Don't throw - this is a non-critical operation
    }
  }

  /**
   * Fix email direction and analyze responses - integrated from fix-email-direction.js
   * This runs automatically after saving emails
   */
  async fixEmailDirectionAndResponses() {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      logger.info('🔧 Fixing Email Direction Classification...');

      // Get connected accounts
      const accountsResult = await client.query(`
        SELECT id, email_address
        FROM email_accounts
        WHERE status = 'active'
      `);
      const connectedAccounts = accountsResult.rows;
      logger.info(`Found ${connectedAccounts.length} active accounts`);

      // Reset all directions to inbound first
      await client.query(`UPDATE emails SET direction = 'inbound'`);

      // Mark emails from business accounts as outbound
      let totalOutbound = 0;

      for (const account of connectedAccounts) {
        const email = account.email_address.toLowerCase();

        // Update emails where sender contains this email address
        const result = await client.query(`
          UPDATE emails
          SET direction = 'outbound'
          WHERE LOWER(sender_email) LIKE $1
          OR LOWER(sender_email) = $2
        `, [`%${email}%`, email]);

        logger.info(`  ${email}: ${result.rowCount} emails marked as outbound`);
        totalOutbound += result.rowCount;
      }

      logger.info(`Total outbound emails: ${totalOutbound}`);

      // Analyze threads for responses
      const threadsResult = await client.query(`
        SELECT DISTINCT thread_id
        FROM emails
        WHERE thread_id IS NOT NULL
      `);

      let threadsWithResponses = 0;
      let emailsMarkedWithResponse = 0;

      for (const thread of threadsResult.rows) {
        // Get all emails in this thread
        const threadEmails = await client.query(`
          SELECT id, direction, received_at
          FROM emails
          WHERE thread_id = $1
          ORDER BY received_at ASC
        `, [thread.thread_id]);

        const hasInbound = threadEmails.rows.some(e => e.direction === 'inbound');
        const hasOutbound = threadEmails.rows.some(e => e.direction === 'outbound');

        if (hasInbound && hasOutbound) {
          threadsWithResponses++;

          // Mark inbound emails as having responses
          const updateResult = await client.query(`
            UPDATE emails
            SET has_response = true
            WHERE thread_id = $1
            AND direction = 'inbound'
          `, [thread.thread_id]);

          emailsMarkedWithResponse += updateResult.rowCount;
        }
      }

      logger.info(`Found ${threadsWithResponses} threads with responses`);
      logger.info(`Marked ${emailsMarkedWithResponse} customer emails as having responses`);

      // Update filtering status
      // Mark outbound emails as filtered
      await client.query(`
        UPDATE emails
        SET filtering_status = 'filtered_out',
            filtering_reason = 'Email from connected business account'
        WHERE direction = 'outbound'
      `);

      // Mark inbound without responses as filtered
      await client.query(`
        UPDATE emails
        SET filtering_status = 'filtered_out',
            filtering_reason = 'No response from business'
        WHERE direction = 'inbound'
        AND (has_response IS NULL OR has_response = false)
      `);

      // Mark inbound with responses as qualified
      const qualifiedResult = await client.query(`
        UPDATE emails
        SET filtering_status = 'qualified'
        WHERE direction = 'inbound'
        AND has_response = true
      `);

      logger.info(`Marked ${qualifiedResult.rowCount} emails as qualified for FAQ generation`);

      await client.query('COMMIT');

      // Return statistics
      const finalStats = await client.query(`
        SELECT
          COUNT(*) as total_emails,
          COUNT(*) FILTER (WHERE direction = 'inbound') as inbound_emails,
          COUNT(*) FILTER (WHERE direction = 'outbound') as outbound_emails,
          COUNT(*) FILTER (WHERE has_response = true) as emails_with_responses,
          COUNT(*) FILTER (WHERE filtering_status = 'qualified') as qualified_emails
        FROM emails
      `);

      return finalStats.rows[0];

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error fixing email direction:', error);
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

  /**
   * Fetch more emails for a specific account using pagination
   */
  async fetchMoreEmails(accountId, options = {}) {
    try {
      const {
        maxEmails = 100, // Default to smaller chunks
        pageToken = null,
        sinceDate = null
      } = options;

      logger.info(`Fetching more emails for account ${accountId}`, {
        maxEmails,
        pageToken: pageToken ? 'present' : 'none',
        sinceDate
      });

      // Get account details
      const accountQuery = 'SELECT * FROM email_accounts WHERE id = $1';
      const accountResult = await db.query(accountQuery, [accountId]);
      
      if (accountResult.rows.length === 0) {
        throw new Error('Account not found');
      }

      const account = accountResult.rows[0];

      // If no pageToken provided, try to get it from the stored sync_cursor
      let actualPageToken = pageToken;
      if (!actualPageToken && account.sync_cursor) {
        actualPageToken = account.sync_cursor;
        logger.info(`Using stored pageToken for account ${accountId}: ${actualPageToken}`);
      }

      // Create a processing job for tracking progress
      const jobId = await this.createProcessingJob(accountId, 'email_fetch_more', {
        maxEmails,
        pageToken: actualPageToken ? 'present' : 'none',
        sinceDate
      });

      try {
        let result;
        
        if (account.provider === 'gmail') {
          result = await this.fetchMoreGmailEmails(account, maxEmails, actualPageToken, sinceDate, jobId);
        } else if (account.provider === 'outlook') {
          result = await this.fetchMoreOutlookEmails(account, maxEmails, actualPageToken, sinceDate, jobId);
        } else {
          throw new Error(`Unsupported provider: ${account.provider}`);
        }

        // Complete the processing job
        await this.completeProcessingJob(jobId, 'completed', {
          synced: result.synced || 0,
          hasMore: result.hasMore || false,
          nextPageToken: result.nextPageToken || null
        });

        return {
          success: true,
          synced: result.synced || 0,
          hasMore: result.hasMore || false,
          nextPageToken: result.nextPageToken || null,
          message: result.message || 'Emails fetched successfully'
        };

      } catch (error) {
        // Mark the job as failed
        await this.completeProcessingJob(jobId, 'failed', {
          error: error.message
        });
        throw error;
      }

    } catch (error) {
      logger.error(`Failed to fetch more emails for account ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Fetch more Gmail emails with pagination
   */
  async fetchMoreGmailEmails(account, maxEmails, pageToken, sinceDate, jobId) {
    const gmailService = new (require('./gmailService'))();

    // Decrypt the tokens before using them
    const decryptedAccessToken = decrypt(account.access_token);
    const decryptedRefreshToken = decrypt(account.refresh_token);

    gmailService.setCredentials({
      access_token: decryptedAccessToken,
      refresh_token: decryptedRefreshToken,
      expiry_date: account.token_expires_at
    });

    try {
      // Use the new fetchMoreEmails method for pagination
      const syncResult = await gmailService.fetchMoreEmails(account.id, { 
        maxEmails,
        pageToken,
        sinceDate,
        onProgress: (processed, total) => {
          // Update processing job progress
          this.updateProcessingJobProgress(jobId, {
            processed,
            total,
            percentage: total > 0 ? Math.round((processed / total) * 100) : 0
          });
        }
      });

      if (syncResult.messages && syncResult.messages.length > 0) {
        await this.saveEmails(account.id, syncResult.messages);
      }

      // Store the new nextPageToken for future fetch more operations
      if (syncResult.nextPageToken) {
        await db.query(
          'UPDATE email_accounts SET sync_cursor = $1, updated_at = NOW() WHERE id = $2',
          [syncResult.nextPageToken, account.id]
        );
        logger.info(`Updated sync_cursor for account ${account.id}: ${syncResult.nextPageToken}`);
      }

      return {
        synced: syncResult.processed || 0,
        hasMore: syncResult.hasMore || false,
        nextPageToken: syncResult.nextPageToken || null,
        message: syncResult.message || 'No emails fetched'
      };

    } catch (error) {
      logger.error(`Gmail fetch more failed for account ${account.id}:`, error);
      throw error;
    }
  }

  /**
   * Fetch more Outlook emails with pagination (placeholder)
   */
  async fetchMoreOutlookEmails(account, maxEmails, pageToken, sinceDate, jobId) {
    // TODO: Implement Outlook pagination
    throw new Error('Outlook pagination not yet implemented');
  }

  /**
   * Create a new processing job
   */
  async createProcessingJob(accountId, jobType, metadata = {}) {
    try {
      const query = `
        INSERT INTO processing_jobs (
          account_id, job_type, status, parameters, 
          total_items, processed_items, progress,
          started_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
        RETURNING id
      `;
      
      const result = await db.query(query, [
        accountId,
        jobType,
        'processing',
        JSON.stringify(metadata),
        metadata.maxEmails || 0,
        0,
        0
      ]);
      
      logger.info(`Created processing job ${result.rows[0].id} for account ${accountId}`, {
        jobType,
        metadata
      });
      
      return result.rows[0].id;
    } catch (error) {
      logger.error(`Failed to create processing job for account ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Update processing job progress
   */
  async updateProcessingJobProgress(jobId, progress) {
    try {
      const query = `
        UPDATE processing_jobs 
        SET 
          processed_items = $1,
          total_items = $2,
          progress = $3,
          updated_at = NOW()
        WHERE id = $4
      `;
      
      await db.query(query, [
        progress.processed || 0,
        progress.total || 0,
        progress.percentage || 0,
        jobId
      ]);
      
      logger.debug(`Updated processing job ${jobId} progress`, progress);
    } catch (error) {
      logger.error(`Failed to update processing job ${jobId} progress:`, error);
      // Don't throw error for progress updates
    }
  }

  /**
   * Complete a processing job
   */
  async completeProcessingJob(jobId, status, result = {}) {
    try {
      const query = `
        UPDATE processing_jobs 
        SET 
          status = $1,
          processed_items = $2,
          total_items = $3,
          progress = $4,
          parameters = $5,
          completed_at = NOW(),
          updated_at = NOW()
        WHERE id = $6
      `;
      
      await db.query(query, [
        status,
        result.synced || 0,
        result.synced || 0, // For fetch more, total = synced
        status === 'completed' ? 100 : 0,
        JSON.stringify(result),
        jobId
      ]);
      
      logger.info(`Completed processing job ${jobId} with status ${status}`, result);
    } catch (error) {
      logger.error(`Failed to complete processing job ${jobId}:`, error);
      throw error;
    }
  }
}

module.exports = EmailService;
