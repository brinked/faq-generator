const { google } = require('googleapis');
const logger = require('../utils/logger');
const redisClient = require('../config/redis');

class GmailService {
  constructor() {
    // Use BASE_URL to construct redirect URI dynamically
    // For production, BASE_URL should be set to your render.com URL
    const baseUrl = process.env.BASE_URL;
    if (!baseUrl) {
      throw new Error('BASE_URL environment variable is required for Gmail OAuth configuration');
    }
    const redirectUri = process.env.GMAIL_REDIRECT_URI || `${baseUrl}/api/auth/gmail/callback`;
    
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      redirectUri
    );
    
    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
  }

  /**
   * Get OAuth2 authorization URL
   */
  getAuthUrl() {
    const scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async getTokens(code) {
    try {
      logger.info('Attempting to exchange authorization code for tokens');
      const response = await this.oauth2Client.getAccessToken(code);
      
      // Log the response structure for debugging
      logger.info('OAuth response structure:', {
        hasTokens: !!response?.tokens,
        responseKeys: Object.keys(response || {}),
        responseType: typeof response
      });
      
      // Handle different response formats
      if (response && response.tokens) {
        return response.tokens;
      } else if (response && (response.access_token || response.accessToken)) {
        // Some versions return tokens directly in the response
        return response;
      } else {
        logger.error('Unexpected OAuth response format:', response);
        throw new Error('Invalid token response format');
      }
    } catch (error) {
      logger.error('Error getting Gmail tokens:', error);
      throw new Error('Failed to exchange authorization code for tokens');
    }
  }

  /**
   * Set credentials for the OAuth2 client
   */
  setCredentials(tokens) {
    this.oauth2Client.setCredentials(tokens);
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(refreshToken) {
    try {
      this.oauth2Client.setCredentials({
        refresh_token: refreshToken
      });

      const { credentials } = await this.oauth2Client.refreshAccessToken();
      return credentials;
    } catch (error) {
      logger.error('Error refreshing Gmail access token:', error);
      throw new Error('Failed to refresh access token');
    }
  }

  /**
   * Get user profile information
   */
  async getUserProfile() {
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
      const response = await oauth2.userinfo.get();
      return response.data;
    } catch (error) {
      logger.error('Error getting Gmail user profile:', error);
      throw new Error('Failed to get user profile');
    }
  }

  /**
   * Get list of messages with optional query
   */
  async getMessages(options = {}) {
    try {
      const {
        query = '',
        maxResults = 100,
        pageToken = null,
        labelIds = null
      } = options;

      const params = {
        userId: 'me',
        q: query,
        maxResults,
        includeSpamTrash: false
      };

      if (pageToken) params.pageToken = pageToken;
      if (labelIds) params.labelIds = labelIds;

      const response = await this.gmail.users.messages.list(params);
      return response.data;
    } catch (error) {
      logger.error('Error getting Gmail messages:', error);
      throw new Error('Failed to get messages');
    }
  }

  /**
   * Get detailed message by ID
   */
  async getMessage(messageId) {
    try {
      const response = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
      });

      return this.parseMessage(response.data);
    } catch (error) {
      logger.error(`Error getting Gmail message ${messageId}:`, error);
      throw new Error('Failed to get message details');
    }
  }

  /**
   * Get multiple messages in batch
   */
  async getMessagesBatch(messageIds) {
    try {
      const messages = [];
      const batchSize = 100; // Gmail API batch limit

      for (let i = 0; i < messageIds.length; i += batchSize) {
        const batch = messageIds.slice(i, i + batchSize);
        const batchPromises = batch.map(id => this.getMessage(id));
        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            messages.push(result.value);
          } else {
            logger.warn(`Failed to get message ${batch[index]}:`, result.reason);
          }
        });
      }

      return messages;
    } catch (error) {
      logger.error('Error getting Gmail messages batch:', error);
      throw new Error('Failed to get messages batch');
    }
  }

  /**
   * Parse Gmail message format
   */
  parseMessage(message) {
    const headers = message.payload.headers || [];
    const getHeader = (name) => {
      const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
      return header ? header.value : null;
    };

    // Extract body content
    const { bodyText, bodyHtml } = this.extractBody(message.payload);

    return {
      id: message.id,
      threadId: message.threadId,
      labelIds: message.labelIds || [],
      snippet: message.snippet,
      historyId: message.historyId,
      internalDate: new Date(parseInt(message.internalDate)),
      subject: getHeader('Subject') || '',
      from: getHeader('From') || '',
      to: getHeader('To') || '',
      cc: getHeader('Cc') || '',
      bcc: getHeader('Bcc') || '',
      date: getHeader('Date') || '',
      messageId: getHeader('Message-ID') || '',
      references: getHeader('References') || '',
      inReplyTo: getHeader('In-Reply-To') || '',
      bodyText,
      bodyHtml,
      attachments: this.extractAttachments(message.payload)
    };
  }

  /**
   * Extract body content from message payload
   */
  extractBody(payload) {
    let bodyText = '';
    let bodyHtml = '';

    const extractFromPart = (part) => {
      if (part.mimeType === 'text/plain' && part.body.data) {
        bodyText += Buffer.from(part.body.data, 'base64').toString('utf-8');
      } else if (part.mimeType === 'text/html' && part.body.data) {
        bodyHtml += Buffer.from(part.body.data, 'base64').toString('utf-8');
      }

      if (part.parts) {
        part.parts.forEach(extractFromPart);
      }
    };

    if (payload.body && payload.body.data) {
      if (payload.mimeType === 'text/plain') {
        bodyText = Buffer.from(payload.body.data, 'base64').toString('utf-8');
      } else if (payload.mimeType === 'text/html') {
        bodyHtml = Buffer.from(payload.body.data, 'base64').toString('utf-8');
      }
    }

    if (payload.parts) {
      payload.parts.forEach(extractFromPart);
    }

    return { bodyText, bodyHtml };
  }

  /**
   * Extract attachment information
   */
  extractAttachments(payload) {
    const attachments = [];

    const extractFromPart = (part) => {
      if (part.filename && part.body.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          size: part.body.size,
          attachmentId: part.body.attachmentId
        });
      }

      if (part.parts) {
        part.parts.forEach(extractFromPart);
      }
    };

    if (payload.parts) {
      payload.parts.forEach(extractFromPart);
    }

    return attachments;
  }

  /**
   * Sync emails for an account with incremental updates
   */
  async syncEmails(accountId, options = {}) {
    try {
      const {
        maxEmails = parseInt(process.env.MAX_EMAILS_PER_SYNC) || 1000,
        query = '',
        sinceDate = null
      } = options;

      logger.info(`Starting Gmail sync for account ${accountId}`);
      const startTime = Date.now();

      // Build query for incremental sync
      let searchQuery = query;
      if (sinceDate) {
        const dateStr = sinceDate.toISOString().split('T')[0].replace(/-/g, '/');
        searchQuery += ` after:${dateStr}`;
      }

      // Get message list
      const messageList = await this.getMessages({
        query: searchQuery,
        maxResults: maxEmails
      });

      if (!messageList.messages || messageList.messages.length === 0) {
        logger.info(`No new messages found for account ${accountId}`);
        return { processed: 0, total: 0 };
      }

      // Get detailed messages in batches
      const messageIds = messageList.messages.map(m => m.id);
      const messages = await this.getMessagesBatch(messageIds);

      const duration = Date.now() - startTime;
      logger.logEmailProcessing(accountId, messages.length, duration);

      return {
        processed: messages.length,
        total: messageList.resultSizeEstimate || messages.length,
        messages
      };

    } catch (error) {
      logger.error(`Gmail sync failed for account ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Test connection with current credentials
   */
  async testConnection() {
    try {
      const profile = await this.getUserProfile();
      const messages = await this.getMessages({ maxResults: 1 });
      
      return {
        success: true,
        email: profile.email,
        name: profile.name,
        messageCount: messages.resultSizeEstimate || 0
      };
    } catch (error) {
      logger.error('Gmail connection test failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get account quota information
   */
  async getQuotaInfo() {
    try {
      // Gmail doesn't have a direct quota API, but we can estimate usage
      const profile = await this.getUserProfile();
      const messages = await this.getMessages({ maxResults: 1 });
      
      return {
        email: profile.email,
        estimatedMessageCount: messages.resultSizeEstimate || 0,
        quotaUsed: 'N/A', // Gmail doesn't expose quota info
        quotaLimit: 'N/A'
      };
    } catch (error) {
      logger.error('Error getting Gmail quota info:', error);
      throw error;
    }
  }
}

module.exports = GmailService;