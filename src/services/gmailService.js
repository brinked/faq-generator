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
    
    logger.info('Gmail OAuth configuration:', {
      baseUrl,
      redirectUri,
      hasClientId: !!process.env.GMAIL_CLIENT_ID,
      hasClientSecret: !!process.env.GMAIL_CLIENT_SECRET
    });
    
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

    // Log the redirect URI being used
    logger.info('Generating Gmail auth URL with redirect URI:', {
      redirectUri: this.oauth2Client._clientOptions?.redirectUri || 'not set',
      clientId: this.oauth2Client._clientId ? 'present' : 'missing'
    });

    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });

    logger.info('Generated Gmail auth URL:', authUrl);
    
    return authUrl;
  }

  /**
   * Exchange authorization code for tokens
   */
  async getTokens(code) {
    try {
      logger.info('Attempting to exchange authorization code for tokens');
      logger.info('OAuth2 client redirect URI:', this.oauth2Client.redirectUri);
      logger.info('Code length:', code ? code.length : 'no code');
      
      // The correct way to exchange the code for tokens
      const response = await this.oauth2Client.getToken(code);
      
      // Log the full response for debugging
      logger.info('OAuth2 getToken response:', {
        hasTokens: !!response.tokens,
        hasRes: !!response.res,
        responseKeys: response ? Object.keys(response) : []
      });
      
      if (!response || !response.tokens) {
        logger.error('Invalid OAuth response structure:', response);
        throw new Error('OAuth response does not contain tokens');
      }
      
      const { tokens } = response;
      
      logger.info('Successfully obtained tokens:', {
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiryDate: tokens.expiry_date,
        expiresIn: tokens.expires_in,
        tokenType: tokens.token_type,
        allKeys: Object.keys(tokens)
      });
      
      return tokens;
    } catch (error) {
      logger.error('Error getting Gmail tokens:', {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        stack: error.stack
      });
      
      // Re-throw the original error with more context
      const enhancedError = new Error(`Failed to exchange authorization code for tokens: ${error.message}`);
      enhancedError.originalError = error;
      throw enhancedError;
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
      logger.info('Attempting to refresh Gmail access token');
      
      this.oauth2Client.setCredentials({
        refresh_token: refreshToken
      });

      const { credentials } = await this.oauth2Client.refreshAccessToken();
      
      logger.info('Successfully refreshed Gmail access token', {
        hasAccessToken: !!credentials.access_token,
        hasRefreshToken: !!credentials.refresh_token,
        expiryDate: credentials.expiry_date
      });
      
      return credentials;
    } catch (error) {
      logger.error('Error refreshing Gmail access token:', {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        stack: error.stack
      });
      
      // Check if it's a permanent failure
      if (error.response?.data?.error === 'invalid_grant') {
        throw new Error('Refresh token is invalid or expired. User needs to re-authenticate.');
      }
      
      throw new Error(`Failed to refresh access token: ${error.message}`);
    }
  }

  /**
   * Get user profile information with enhanced fallback mechanisms
   */
  async getUserProfile() {
    try {
      // Method 1: Try OAuth2 userinfo API
      try {
        const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
        const response = await oauth2.userinfo.get();
        
        logger.info('Gmail userinfo API response:', {
          hasData: !!response.data,
          dataKeys: response.data ? Object.keys(response.data) : [],
          email: response.data?.email,
          verified_email: response.data?.verified_email,
          status: response.status
        });
        
        let email = response.data.email || response.data.emailAddress;
        
        if (!email && Array.isArray(response.data.emails) && response.data.emails.length > 0) {
          const primaryEmail = response.data.emails.find(e => e.type === 'account' && e.value);
          email = primaryEmail ? primaryEmail.value : response.data.emails[0].value;
          logger.info('Using email from emails array:', { email });
        }
        
        if (email) {
          return {
            ...response.data,
            email: email,
            name: response.data.name || response.data.given_name || email.split('@')[0]
          };
        }
        
        logger.warn('No email found in userinfo API response, trying fallback methods');
      } catch (userInfoError) {
        logger.warn('OAuth2 userinfo API failed, trying fallback methods:', {
          message: userInfoError.message,
          status: userInfoError.response?.status
        });
      }
      
      // Method 2: Try Gmail API to get profile
      try {
        const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
        const profileResponse = await gmail.users.getProfile({ userId: 'me' });
        
        logger.info('Gmail profile API response:', {
          emailAddress: profileResponse.data.emailAddress,
          messagesTotal: profileResponse.data.messagesTotal
        });
        
        if (profileResponse.data.emailAddress) {
          return {
            email: profileResponse.data.emailAddress,
            name: profileResponse.data.emailAddress.split('@')[0],
            verified_email: true
          };
        }
      } catch (profileError) {
        logger.warn('Gmail profile API failed:', {
          message: profileError.message,
          status: profileError.response?.status
        });
      }
      
      // Method 3: Try to extract email from JWT token
      try {
        const credentials = this.oauth2Client.credentials;
        if (credentials.id_token) {
          const jwt = require('jsonwebtoken');
          const decoded = jwt.decode(credentials.id_token);
          
          logger.info('JWT token decoded:', {
            hasEmail: !!decoded?.email,
            hasEmailVerified: !!decoded?.email_verified,
            aud: decoded?.aud,
            iss: decoded?.iss
          });
          
          if (decoded && decoded.email) {
            return {
              email: decoded.email,
              name: decoded.name || decoded.given_name || decoded.email.split('@')[0],
              verified_email: decoded.email_verified || false,
              picture: decoded.picture
            };
          }
        }
      } catch (jwtError) {
        logger.warn('JWT token extraction failed:', {
          message: jwtError.message,
          hasIdToken: !!this.oauth2Client.credentials?.id_token
        });
      }
      
      // Method 4: Try alternative OAuth2 v1 API
      try {
        const oauth2v1 = google.oauth2({ version: 'v1', auth: this.oauth2Client });
        const response = await oauth2v1.userinfo.get();
        
        logger.info('OAuth2 v1 userinfo response:', {
          email: response.data.email,
          verified_email: response.data.verified_email
        });
        
        if (response.data.email) {
          return {
            ...response.data,
            email: response.data.email,
            name: response.data.name || response.data.email.split('@')[0]
          };
        }
      } catch (v1Error) {
        logger.warn('OAuth2 v1 API failed:', {
          message: v1Error.message,
          status: v1Error.response?.status
        });
      }
      
      // If all methods fail, throw an error
      logger.error('All profile extraction methods failed - no email address could be retrieved');
      throw new Error('Unable to retrieve email address from Google profile after trying all available methods');
      
    } catch (error) {
      logger.error('Critical error in getUserProfile:', {
        message: error.message,
        stack: error.stack,
        credentials: {
          hasAccessToken: !!this.oauth2Client.credentials?.access_token,
          hasRefreshToken: !!this.oauth2Client.credentials?.refresh_token,
          hasIdToken: !!this.oauth2Client.credentials?.id_token
        }
      });
      throw error;
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

      logger.info('Calling Gmail API messages.list', { params });

      const response = await this.gmail.users.messages.list(params);
      
      logger.info('Gmail API messages.list response', {
        messagesCount: response.data.messages?.length || 0,
        resultSizeEstimate: response.data.resultSizeEstimate,
        nextPageToken: response.data.nextPageToken
      });

      return response.data;
    } catch (error) {
      logger.error('Error getting Gmail messages:', {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        status: error.response?.status
      });
      
      // Preserve the original error for upstream handling
      const enhancedError = new Error(`Failed to get messages: ${error.message}`);
      enhancedError.originalError = error;
      enhancedError.code = error.code;
      enhancedError.response = error.response;
      
      throw enhancedError;
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

      logger.info(`Starting Gmail sync for account ${accountId}`, {
        maxEmails,
        query,
        sinceDate
      });
      const startTime = Date.now();

      // Build query for incremental sync
      let searchQuery = query;
      if (sinceDate) {
        const dateStr = sinceDate.toISOString().split('T')[0].replace(/-/g, '/');
        searchQuery += ` after:${dateStr}`;
      }

      logger.info(`Gmail sync query: "${searchQuery}" for account ${accountId}`);

      // Get message list
      const messageList = await this.getMessages({
        query: searchQuery,
        maxResults: maxEmails
      });

      logger.info(`Gmail API returned ${messageList.messages?.length || 0} messages for account ${accountId}`);

      if (!messageList.messages || messageList.messages.length === 0) {
        logger.info(`No new messages found for account ${accountId}`);
        return { processed: 0, total: 0 };
      }

      // Get detailed messages in batches
      const messageIds = messageList.messages.map(m => m.id);
      logger.info(`Fetching ${messageIds.length} messages in batches for account ${accountId}`);
      
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