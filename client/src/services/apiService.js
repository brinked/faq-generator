// Determine the API base URL based on environment
const getApiBaseUrl = () => {
  // If REACT_APP_API_URL is explicitly set, use it
  if (process.env.REACT_APP_API_URL) {
    return process.env.REACT_APP_API_URL;
  }
  
  // In production, use the same domain as the frontend
  if (process.env.NODE_ENV === 'production') {
    return window.location.origin;
  }
  
  // In development, use localhost
  return 'http://localhost:3000';
};

const API_BASE_URL = getApiBaseUrl();

class ApiService {
  constructor() {
    this.baseURL = API_BASE_URL;
  }

  // Basic HTTP methods
  async get(endpoint, options = {}) {
    return this.request(endpoint, {
      method: 'GET',
      ...options,
    });
  }

  async post(endpoint, data = null, options = {}) {
    return this.request(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
      ...options,
    });
  }

  async put(endpoint, data = null, options = {}) {
    return this.request(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
      ...options,
    });
  }

  async patch(endpoint, data = null, options = {}) {
    return this.request(endpoint, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
      ...options,
    });
  }

  async delete(endpoint, options = {}) {
    return this.request(endpoint, {
      method: 'DELETE',
      ...options,
    });
  }

  // Helper method for making API requests
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    try {
      const response = await fetch(url, config);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`API request failed: ${endpoint}`, error);
      throw error;
    }
  }

  // Account management
  async getConnectedAccounts() {
    const response = await this.get('/api/accounts');
    return response.accounts || [];
  }

  async connectGmailAccount() {
    return this.get('/api/auth/gmail');
  }

  async connectOutlookAccount() {
    return this.get('/api/auth/outlook');
  }
  
  async getGmailAuthUrl() {
    console.log('Requesting Gmail auth URL');
    const response = await this.get('/api/auth/gmail/url');
    console.log('Gmail auth URL response:', response);
    return response.authUrl;
  }

  async getOutlookAuthUrl() {
    console.log('Requesting Outlook auth URL');
    const response = await this.get('/api/auth/outlook/url');
    console.log('Outlook auth URL response:', response);
    return response.authUrl;
  }

  async handleGmailCallback(code) {
    return this.post('/api/auth/gmail/callback', { code });
  }

  async handleOutlookCallback(code) {
    return this.post('/api/auth/outlook/callback', { code });
  }

  async disconnectAccount(accountId) {
    return this.delete(`/api/accounts/${accountId}`);
  }

  // Email processing
  async startEmailProcessing(accountId) {
    return this.post(`/api/accounts/${accountId}/sync`);
  }

  async syncAllEmails() {
    return this.post('/api/dashboard/sync-all');
  }

  async getEmailStats() {
    return this.get('/api/emails/stats');
  }

  async getProcessingStatus() {
    return this.get('/api/dashboard/processing-status');
  }

  async getSyncStatus(accountId) {
    return this.get(`/api/accounts/${accountId}/sync-status`);
  }

  // FAQ management
  async getFAQs(filters = {}) {
    const queryParams = new URLSearchParams();
    
    if (filters.search) queryParams.append('search', filters.search);
    if (filters.category) queryParams.append('category', filters.category);
    if (filters.sortBy) queryParams.append('sortBy', filters.sortBy);
    
    // Set a high limit to get all FAQs by default, unless specifically limited
    const limit = filters.limit || 1000;
    queryParams.append('limit', limit);
    
    if (filters.offset) queryParams.append('offset', filters.offset);

    const queryString = queryParams.toString();
    const endpoint = `/api/faqs?${queryString}`;
    
    const response = await this.get(endpoint);
    // The API returns { success: true, faqs: [...], pagination: {...} }
    // But the component expects just the array
    return response.faqs || [];
  }

  async getFAQById(faqId) {
    return this.get(`/api/faqs/${faqId}`);
  }

  async updateFAQ(faqId, updates) {
    return this.put(`/api/faqs/${faqId}`, updates);
  }

  async deleteFAQ(faqId) {
    return this.delete(`/api/faqs/${faqId}`);
  }

  async regenerateFAQs() {
    return this.post('/api/faqs/regenerate');
  }

  async publishAllFAQs() {
    return this.post('/api/faqs/publish-all');
  }

  async getFAQCategories() {
    return this.get('/api/faqs/categories');
  }

  async getFAQSources(faqId) {
    return this.get(`/api/faq-sources/${faqId}/sources`);
  }

  // Dashboard and analytics
  async getDashboardStats() {
    return this.get('/api/dashboard/stats');
  }

  async getEmailAnalytics(timeRange = '30d') {
    return this.get(`/api/dashboard/analytics?timeRange=${timeRange}`);
  }

  // Export functionality
  async exportFAQs(format = 'json') {
    const response = await fetch(`${this.baseURL}/api/export/faqs?format=${format}`, {
      method: 'GET',
      headers: {
        'Accept': format === 'csv' ? 'text/csv' : 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Export failed: ${response.status}`);
    }

    if (format === 'csv') {
      return await response.text();
    } else {
      return await response.json();
    }
  }

  async exportEmails(format = 'json', filters = {}) {
    const queryParams = new URLSearchParams();
    queryParams.append('format', format);
    
    Object.entries(filters).forEach(([key, value]) => {
      if (value) queryParams.append(key, value);
    });

    const response = await fetch(`${this.baseURL}/api/export/emails?${queryParams.toString()}`, {
      method: 'GET',
      headers: {
        'Accept': format === 'csv' ? 'text/csv' : 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Export failed: ${response.status}`);
    }

    if (format === 'csv') {
      return await response.text();
    } else {
      return await response.json();
    }
  }

  // Search functionality
  async searchEmails(query, filters = {}) {
    const queryParams = new URLSearchParams();
    queryParams.append('q', query);
    
    Object.entries(filters).forEach(([key, value]) => {
      if (value) queryParams.append(key, value);
    });

    return this.get(`/api/emails/search?${queryParams.toString()}`);
  }

  async searchFAQs(query, filters = {}) {
    const queryParams = new URLSearchParams();
    queryParams.append('q', query);
    
    Object.entries(filters).forEach(([key, value]) => {
      if (value) queryParams.append(key, value);
    });

    return this.get(`/api/faqs/search?${queryParams.toString()}`);
  }

  // Health check
  async healthCheck() {
    return this.get('/api/health');
  }

  // FAQ Processing
  async getFAQStatus() {
    return this.get('/api/sync/faq-status');
  }

  async processFAQs(limit = 100) {
    return this.post('/api/sync/process-faqs', { limit });
  }

  async generateFAQs(options = {}) {
    const defaultOptions = {
      minQuestionCount: 1,
      maxFAQs: 20,
      forceRegenerate: false,
      autoFix: true
    };
    return this.post('/api/sync/generate-faqs', { ...defaultOptions, ...options });
  }

  // Email Filtering Stats
  async getEmailFilteringStats(accountId = null) {
    const endpoint = accountId ? `/api/emails/stats/filtering?accountId=${accountId}` : '/api/emails/stats/filtering';
    return this.get(endpoint);
  }

  // OAuth URL generation
  async getGmailAuthUrl() {
    const response = await this.get('/api/auth/gmail/url');
    return response.authUrl;
  }

  async getOutlookAuthUrl() {
    const response = await this.get('/api/auth/outlook/url');
    return response.authUrl;
  }

  // File download helper
  async downloadFile(url, filename) {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      
      // Create download link
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('Download failed:', error);
      throw error;
    }
  }

  // Utility methods
  formatError(error) {
    if (error.response && error.response.data && error.response.data.message) {
      return error.response.data.message;
    }
    return error.message || 'An unexpected error occurred';
  }

  isOnline() {
    return navigator.onLine;
  }
}

export const apiService = new ApiService();
export default apiService;