const { ConfidentialClientApplication } = require('@azure/msal-node');
const axios = require('axios');
const logger = require('../utils/logger');

class OutlookService {
  constructor() {
    // Use BASE_URL to construct redirect URI dynamically
    // For production, BASE_URL should be set to your render.com URL
    const baseUrl = process.env.BASE_URL;
    if (!baseUrl) {
      throw new Error('BASE_URL environment variable is required for Outlook OAuth configuration');
    }
    this.redirectUri = process.env.OUTLOOK_REDIRECT_URI || `${baseUrl}/api/auth/outlook/callback`;
    
    this.msalConfig = {
      auth: {
        clientId: process.env.OUTLOOK_CLIENT_ID,
        clientSecret: process.env.OUTLOOK_CLIENT_SECRET,
        authority: `https://login.microsoftonline.com/${process.env.OUTLOOK_TENANT_ID || 'common'}`
      }
    };
    
    this.cca = new ConfidentialClientApplication(this.msalConfig);
    this.graphBaseUrl = 'https://graph.microsoft.com/v1.0';
  }

  /**
   * Get OAuth2 authorization URL
   */
  getAuthUrl() {
    logger.info('Generating Outlook auth URL with redirect URI:', {
      redirectUri: this.redirectUri,
      clientId: this.msalConfig.auth.clientId ? 'present' : 'missing'
    });
    const scopes = [
      'https://graph.microsoft.com/Mail.Read',
      'https://graph.microsoft.com/User.Read'
    ];

    const authCodeUrlParameters = {
      scopes,
      redirectUri: this.redirectUri,
      responseMode: 'query'
    };

    return this.cca.getAuthCodeUrl(authCodeUrlParameters);
  }

  /**
   * Exchange authorization code for tokens
   */
  async getTokens(code) {
    try {
      const tokenRequest = {
        code,
        scopes: [
          'https://graph.microsoft.com/Mail.Read',
          'https://graph.microsoft.com/User.Read'
        ],
        redirectUri: this.redirectUri
      };

      const response = await this.cca.acquireTokenByCode(tokenRequest);
      return {
        access_token: response.accessToken,
        refresh_token: response.refreshToken,
        expires_in: response.expiresOn ? Math.floor((response.expiresOn.getTime() - Date.now()) / 1000) : 3600,
        token_type: 'Bearer'
      };
    } catch (error) {
      logger.error('Error getting Outlook tokens:', error);
      throw new Error('Failed to exchange authorization code for tokens');
    }
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(refreshToken) {
    try {
      const refreshTokenRequest = {
        refreshToken,
        scopes: [
          'https://graph.microsoft.com/Mail.Read',
          'https://graph.microsoft.com/User.Read'
        ]
      };

      const response = await this.cca.acquireTokenByRefreshToken(refreshTokenRequest);
      return {
        access_token: response.accessToken,
        refresh_token: response.refreshToken || refreshToken,
        expires_in: response.expiresOn ? Math.floor((response.expiresOn.getTime() - Date.now()) / 1000) : 3600,
        token_type: 'Bearer'
      };
    } catch (error) {
      logger.error('Error refreshing Outlook access token:', error);
      throw new Error('Failed to refresh access token');
    }
  }

  /**
   * Make authenticated request to Microsoft Graph API
   */
  async makeGraphRequest(endpoint, accessToken, options = {}) {
    try {
      const config = {
        method: options.method || 'GET',
        url: `${this.graphBaseUrl}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        ...options
      };

      const response = await axios(config);
      return response.data;
    } catch (error) {
      logger.error(`Graph API request failed for ${endpoint}:`, error.response?.data || error.message);
      
      if (error.response?.status === 401) {
        throw new Error('Access token expired or invalid');
      }
      
      throw new Error(`Graph API request failed: ${error.message}`);
    }
  }

  /**
   * Get user profile information
   */
  async getUserProfile(accessToken) {
    try {
      return await this.makeGraphRequest('/me', accessToken);
    } catch (error) {
      logger.error('Error getting Outlook user profile:', error);
      throw new Error('Failed to get user profile');
    }
  }

  /**
   * Get list of messages with optional filters
   */
  async getMessages(accessToken, options = {}) {
    try {
      const {
        top = 100,
        skip = 0,
        filter = '',
        orderby = 'receivedDateTime desc',
        select = 'id,subject,bodyPreview,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,sentDateTime,conversationId,hasAttachments'
      } = options;

      let endpoint = `/me/messages?$top=${top}&$skip=${skip}&$orderby=${orderby}&$select=${select}`;
      
      if (filter) {
        endpoint += `&$filter=${encodeURIComponent(filter)}`;
      }

      return await this.makeGraphRequest(endpoint, accessToken);
    } catch (error) {
      logger.error('Error getting Outlook messages:', error);
      throw new Error('Failed to get messages');
    }
  }

  /**
   * Get detailed message by ID
   */
  async getMessage(accessToken, messageId) {
    try {
      const message = await this.makeGraphRequest(`/me/messages/${messageId}`, accessToken);
      return this.parseMessage(message);
    } catch (error) {
      logger.error(`Error getting Outlook message ${messageId}:`, error);
      throw new Error('Failed to get message details');
    }
  }

  /**
   * Get multiple messages in batch
   */
  async getMessagesBatch(accessToken, messageIds) {
    try {
      const messages = [];
      const batchSize = 20; // Microsoft Graph batch limit

      for (let i = 0; i < messageIds.length; i += batchSize) {
        const batch = messageIds.slice(i, i + batchSize);
        
        // Create batch request
        const batchRequest = {
          requests: batch.map((id, index) => ({
            id: index.toString(),
            method: 'GET',
            url: `/me/messages/${id}`
          }))
        };

        const batchResponse = await this.makeGraphRequest('/$batch', accessToken, {
          method: 'POST',
          data: batchRequest
        });

        // Process batch responses
        batchResponse.responses.forEach(response => {
          if (response.status === 200) {
            messages.push(this.parseMessage(response.body));
          } else {
            logger.warn(`Failed to get message in batch: ${response.status}`);
          }
        });
      }

      return messages;
    } catch (error) {
      logger.error('Error getting Outlook messages batch:', error);
      throw new Error('Failed to get messages batch');
    }
  }

  /**
   * Parse Outlook message format
   */
  parseMessage(message) {
    const parseEmailAddress = (emailObj) => {
      if (!emailObj) return '';
      return emailObj.emailAddress ? `${emailObj.emailAddress.name || ''} <${emailObj.emailAddress.address}>`.trim() : '';
    };

    const parseEmailAddresses = (emailArray) => {
      if (!emailArray || !Array.isArray(emailArray)) return [];
      return emailArray.map(parseEmailAddress).filter(email => email);
    };

    return {
      id: message.id,
      threadId: message.conversationId,
      subject: message.subject || '',
      from: parseEmailAddress(message.from),
      to: parseEmailAddresses(message.toRecipients).join(', '),
      cc: parseEmailAddresses(message.ccRecipients).join(', '),
      bcc: parseEmailAddresses(message.bccRecipients).join(', '),
      receivedDateTime: new Date(message.receivedDateTime),
      sentDateTime: new Date(message.sentDateTime),
      bodyText: message.body?.contentType === 'text' ? message.body.content : this.stripHtml(message.body?.content || ''),
      bodyHtml: message.body?.contentType === 'html' ? message.body.content : '',
      bodyPreview: message.bodyPreview || '',
      hasAttachments: message.hasAttachments || false,
      importance: message.importance || 'normal',
      isRead: message.isRead || false,
      webLink: message.webLink || ''
    };
  }

  /**
   * Strip HTML tags from content
   */
  stripHtml(html) {
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  }

  /**
   * Sync emails for an account with incremental updates
   */
  async syncEmails(accessToken, accountId, options = {}) {
    try {
      const {
        maxEmails = parseInt(process.env.MAX_EMAILS_PER_SYNC) || 1000,
        sinceDate = null
      } = options;

      logger.info(`Starting Outlook sync for account ${accountId}`);
      const startTime = Date.now();

      // Build filter for incremental sync
      let filter = '';
      if (sinceDate) {
        const isoDate = sinceDate.toISOString();
        filter = `receivedDateTime ge ${isoDate}`;
      }

      // Get message list
      const messageList = await this.getMessages(accessToken, {
        top: maxEmails,
        filter,
        orderby: 'receivedDateTime desc'
      });

      if (!messageList.value || messageList.value.length === 0) {
        logger.info(`No new messages found for account ${accountId}`);
        return { processed: 0, total: 0 };
      }

      // Get detailed messages in batches
      const messageIds = messageList.value.map(m => m.id);
      const messages = await this.getMessagesBatch(accessToken, messageIds);

      const duration = Date.now() - startTime;
      logger.logEmailProcessing(accountId, messages.length, duration);

      return {
        processed: messages.length,
        total: messageList['@odata.count'] || messages.length,
        messages,
        nextLink: messageList['@odata.nextLink']
      };

    } catch (error) {
      logger.error(`Outlook sync failed for account ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Get messages from a specific folder
   */
  async getMessagesFromFolder(accessToken, folderId, options = {}) {
    try {
      const {
        top = 100,
        skip = 0,
        filter = '',
        orderby = 'receivedDateTime desc'
      } = options;

      let endpoint = `/me/mailFolders/${folderId}/messages?$top=${top}&$skip=${skip}&$orderby=${orderby}`;
      
      if (filter) {
        endpoint += `&$filter=${encodeURIComponent(filter)}`;
      }

      return await this.makeGraphRequest(endpoint, accessToken);
    } catch (error) {
      logger.error(`Error getting messages from folder ${folderId}:`, error);
      throw new Error('Failed to get messages from folder');
    }
  }

  /**
   * Get mail folders
   */
  async getMailFolders(accessToken) {
    try {
      return await this.makeGraphRequest('/me/mailFolders', accessToken);
    } catch (error) {
      logger.error('Error getting mail folders:', error);
      throw new Error('Failed to get mail folders');
    }
  }

  /**
   * Test connection with current credentials
   */
  async testConnection(accessToken) {
    try {
      const profile = await this.getUserProfile(accessToken);
      const messages = await this.getMessages(accessToken, { top: 1 });
      
      return {
        success: true,
        email: profile.mail || profile.userPrincipalName,
        name: profile.displayName,
        messageCount: messages['@odata.count'] || 0
      };
    } catch (error) {
      logger.error('Outlook connection test failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get account quota information
   */
  async getQuotaInfo(accessToken) {
    try {
      const profile = await this.getUserProfile(accessToken);
      const messages = await this.getMessages(accessToken, { top: 1 });
      
      // Outlook/Exchange doesn't expose quota info through Graph API
      return {
        email: profile.mail || profile.userPrincipalName,
        estimatedMessageCount: messages['@odata.count'] || 0,
        quotaUsed: 'N/A',
        quotaLimit: 'N/A'
      };
    } catch (error) {
      logger.error('Error getting Outlook quota info:', error);
      throw error;
    }
  }

  /**
   * Search messages with query
   */
  async searchMessages(accessToken, query, options = {}) {
    try {
      const {
        top = 100,
        skip = 0
      } = options;

      const endpoint = `/me/messages?$search="${encodeURIComponent(query)}"&$top=${top}&$skip=${skip}&$orderby=receivedDateTime desc`;
      
      return await this.makeGraphRequest(endpoint, accessToken);
    } catch (error) {
      logger.error(`Error searching messages with query "${query}":`, error);
      throw new Error('Failed to search messages');
    }
  }
}

module.exports = OutlookService;