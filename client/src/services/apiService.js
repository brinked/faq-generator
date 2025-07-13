const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

class ApiService {
  constructor() {
    this.baseURL = API_BASE_URL;
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
    return this.request('/api/accounts');
  }

  async connectGmailAccount() {
    return this.request('/api/auth/gmail');
  }

  async connectOutlookAccount() {
    return this.request('/api/auth/outlook');
  }

  async handleGmailCallback(code) {
    return this.request('/api/auth/gmail/callback', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  async handleOutlookCallback(code) {
    return this.request('/api/auth/outlook/callback', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  async disconnectAccount(accountId) {
    return this.request(`/api/accounts/${accountId}`, {
      method: 'DELETE',
    });
  }

  // Email processing
  async startEmailProcessing(accountId) {
    return this.request('/api/emails/sync', {
      method: 'POST',
      body: JSON.stringify({ accountId }),
    });
  }

  async syncAllEmails() {
    return this.request('/api/emails/sync-all', {
      method: 'POST',
    });
  }

  async getEmailStats() {
    return this.request('/api/emails/stats');
  }

  async getProcessingStatus() {
    return this.request('/api/dashboard/processing-status');
  }

  // FAQ management
  async getFAQs(filters = {}) {
    const queryParams = new URLSearchParams();
    
    if (filters.search) queryParams.append('search', filters.search);
    if (filters.category) queryParams.append('category', filters.category);
    if (filters.sortBy) queryParams.append('sortBy', filters.sortBy);
    if (filters.limit) queryParams.append('limit', filters.limit);
    if (filters.offset) queryParams.append('offset', filters.offset);

    const queryString = queryParams.toString();
    const endpoint = queryString ? `/api/faqs?${queryString}` : '/api/faqs';
    
    return this.request(endpoint);
  }

  async getFAQById(faqId) {
    return this.request(`/api/faqs/${faqId}`);
  }

  async updateFAQ(faqId, updates) {
    return this.request(`/api/faqs/${faqId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteFAQ(faqId) {
    return this.request(`/api/faqs/${faqId}`, {
      method: 'DELETE',
    });
  }

  async regenerateFAQs() {
    return this.request('/api/faqs/regenerate', {
      method: 'POST',
    });
  }

  async getFAQCategories() {
    return this.request('/api/faqs/categories');
  }

  // Dashboard and analytics
  async getDashboardStats() {
    return this.request('/api/dashboard/stats');
  }

  async getEmailAnalytics(timeRange = '30d') {
    return this.request(`/api/dashboard/analytics?timeRange=${timeRange}`);
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

    return this.request(`/api/emails/search?${queryParams.toString()}`);
  }

  async searchFAQs(query, filters = {}) {
    const queryParams = new URLSearchParams();
    queryParams.append('q', query);
    
    Object.entries(filters).forEach(([key, value]) => {
      if (value) queryParams.append(key, value);
    });

    return this.request(`/api/faqs/search?${queryParams.toString()}`);
  }

  // Health check
  async healthCheck() {
    return this.request('/api/health');
  }

  // OAuth URL generation
  getGmailAuthUrl() {
    return `${this.baseURL}/api/auth/gmail`;
  }

  getOutlookAuthUrl() {
    return `${this.baseURL}/api/auth/outlook`;
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