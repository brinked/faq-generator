const { google } = require('googleapis');
const logger = require('../utils/logger');
const redisClient = require('../config/redis');
const jwt = require('jsonwebtoken');

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
        const profileResponse = await this.gmail.users.getProfile({ userId: 'me' });
        
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
   * Get messages from Gmail
   */
  async getMessages(options = {}) {
    try {
      const {
        query = '',
        maxResults = 500, // Gmail API maximum per request
        pageToken = null,
        labelIds = null
      } = options;

      logger.info(`Getting Gmail messages`, {
        query,
        maxResults,
        pageToken: pageToken ? 'present' : 'none',
        labelIds
      });

      const params = {
        userId: 'me', // Required by Gmail API
        q: query,
        maxResults: Math.min(maxResults, 500), // Ensure we don't exceed Gmail's limit
        includeSpamTrash: false
      };

      // Add pageToken if provided
      if (pageToken) {
        params.pageToken = pageToken;
      }

      // Add labelIds if provided
      if (labelIds && labelIds.length > 0) {
        params.labelIds = labelIds;
      }

      const response = await this.gmail.users.messages.list(params);
      
      logger.info(`Gmail API response`, {
        resultSizeEstimate: response.data.resultSizeEstimate,
        messagesCount: response.data.messages?.length || 0,
        nextPageToken: response.data.nextPageToken ? 'present' : 'none'
      });

      return {
        messages: response.data.messages || [],
        resultSizeEstimate: response.data.resultSizeEstimate || 0,
        nextPageToken: response.data.nextPageToken || null
      };

    } catch (error) {
      logger.error('Failed to get Gmail messages:', error);
      throw error;
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
   * Sync emails for an account with incremental updates and proper pagination
   */
  async syncEmails(accountId, options = {}) {
    try {
      const {
        maxEmails = parseInt(process.env.MAX_EMAILS_PER_SYNC) || 1000,
        query = '',
        sinceDate = null,
        onProgress = null
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

      // Gmail API has a hard limit of 500 messages per request
      // We need to use pagination to get all messages
      const gmailBatchSize = 500; // Gmail API maximum
      const allMessages = [];
      let pageToken = null;
      let totalProcessed = 0;
      let hasMoreMessages = true;

      while (hasMoreMessages && allMessages.length < maxEmails) {
        // Get message list with pagination
        const messageList = await this.getMessages({
          query: searchQuery,
          maxResults: Math.min(gmailBatchSize, maxEmails - allMessages.length),
          pageToken: pageToken
        });

        const currentMessages = messageList.messages || [];
        const currentCount = currentMessages.length;
        
        logger.info(`Gmail API batch returned ${currentCount} messages for account ${accountId} (pageToken: ${pageToken ? 'present' : 'none'})`);

        if (currentCount === 0) {
          logger.info(`No more messages found for account ${accountId}`);
          break;
        }

        // Add messages to our collection
        allMessages.push(...currentMessages);
        totalProcessed += currentCount;

        // Report progress
        if (onProgress) {
          onProgress(totalProcessed, Math.max(messageList.resultSizeEstimate || totalProcessed, maxEmails));
        }

        // Check if there are more messages
        pageToken = messageList.nextPageToken;
        hasMoreMessages = !!pageToken && currentCount >= gmailBatchSize;

        // Small delay to prevent rate limiting
        if (hasMoreMessages) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        logger.info(`Processed ${totalProcessed} messages so far, hasMore: ${hasMoreMessages}`);
      }

      const totalMessages = allMessages.length;
      logger.info(`Total messages collected: ${totalMessages} for account ${accountId}`);

      if (totalMessages === 0) {
        logger.info(`No messages found for account ${accountId}`);
        if (onProgress) onProgress(0, 0);
        return { processed: 0, total: 0 };
      }

      // Get detailed messages in batches
      const messageIds = allMessages.map(m => m.id);
      logger.info(`Fetching ${messageIds.length} messages in batches for account ${accountId}`);
      
      // Process messages in smaller batches for better progress tracking
      const batchSize = 50; // Process 50 emails at a time
      const messages = [];
      let processedCount = 0;

      for (let i = 0; i < messageIds.length; i += batchSize) {
        const batchIds = messageIds.slice(i, i + batchSize);
        const batchMessages = await this.getMessagesBatch(batchIds);
        messages.push(...batchMessages);
        
        processedCount += batchMessages.length;
        
        // Report progress
        if (onProgress) {
          onProgress(processedCount, totalMessages);
        }
        
        // Small delay to prevent rate limiting
        if (i + batchSize < messageIds.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      const duration = Date.now() - startTime;
      logger.logEmailProcessing(accountId, messages.length, duration);

      return {
        processed: messages.length,
        total: totalMessages,
        messages,
        hasMore: hasMoreMessages,
        nextPageToken: pageToken
      };

    } catch (error) {
      logger.error(`Gmail sync failed for account ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Fetch more emails using pageToken for pagination
   */
  async fetchMoreEmails(accountId, options = {}) {
    try {
      const {
        maxEmails = 100, // Default to smaller chunks
        pageToken = null,
        query = '',
        sinceDate = null,
        onProgress = null
      } = options;

      logger.info(`Fetching more Gmail emails for account ${accountId}`, {
        maxEmails,
        pageToken: pageToken ? 'present' : 'none',
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

      logger.info(`Gmail fetch more query: "${searchQuery}" for account ${accountId}`);

      // Get the next batch of messages using pageToken
      const messageList = await this.getMessages({
        query: searchQuery,
        maxResults: Math.min(maxEmails, 500), // Gmail API maximum
        pageToken: pageToken
      });

      const messages = messageList.messages || [];
      const currentCount = messages.length;
      const nextPageToken = messageList.nextPageToken;
      
      logger.info(`Gmail API returned ${currentCount} messages for account ${accountId}`, {
        pageToken: pageToken ? 'present' : 'none',
        nextPageToken: nextPageToken ? 'present' : 'none',
        hasMore: !!nextPageToken
      });

      if (currentCount === 0) {
        logger.info(`No more messages found for account ${accountId}`);
        if (onProgress) onProgress(0, 0);
        return { 
          processed: 0, 
          total: 0, 
          hasMore: false, 
          nextPageToken: null,
          message: 'No more emails to fetch'
        };
      }

      // Get detailed messages in batches
      const messageIds = messages.map(m => m.id);
      logger.info(`Fetching ${messageIds.length} messages in batches for account ${accountId}`);
      
      // Process messages in smaller batches for better progress tracking
      const batchSize = 50; // Process 50 emails at a time
      const detailedMessages = [];
      let processedCount = 0;

      for (let i = 0; i < messageIds.length; i += batchSize) {
        const batchIds = messageIds.slice(i, i + batchSize);
        const batchMessages = await this.getMessagesBatch(batchIds);
        detailedMessages.push(...batchMessages);
        
        processedCount += batchMessages.length;
        
        // Report progress
        if (onProgress) {
          onProgress(processedCount, currentCount);
        }
        
        // Small delay to prevent rate limiting
        if (i + batchSize < messageIds.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      const duration = Date.now() - startTime;
      logger.logEmailProcessing(accountId, detailedMessages.length, duration);

      return {
        processed: detailedMessages.length,
        total: currentCount,
        messages: detailedMessages,
        hasMore: !!nextPageToken,
        nextPageToken: nextPageToken,
        message: detailedMessages.length > 0 
          ? `Fetched ${detailedMessages.length} emails successfully`
          : 'No emails fetched'
      };

    } catch (error) {
      logger.error(`Gmail fetch more failed for account ${accountId}:`, error);
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