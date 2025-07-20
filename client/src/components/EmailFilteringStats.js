import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { apiService } from '../services/apiService';
import LoadingSpinner from './LoadingSpinner';

const EmailFilteringStats = ({ connectedAccounts }) => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedAccount, setSelectedAccount] = useState('all');

  useEffect(() => {
    loadStats();
  }, [selectedAccount]);

  const loadStats = async () => {
    try {
      setLoading(true);
      const accountId = selectedAccount === 'all' ? null : selectedAccount;
      const response = await fetch(`/api/emails/stats/filtering${accountId ? `?accountId=${accountId}` : ''}`);
      const data = await response.json();
      
      if (data.success) {
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Failed to load filtering stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <LoadingSpinner />
        <span className="ml-2">Loading filtering statistics...</span>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-center p-8 text-gray-500">
        Failed to load filtering statistics
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-xl font-semibold text-gray-900">Email Filtering Statistics</h3>
          <p className="text-sm text-gray-600">
            Shows how the improved filtering reduces spam and irrelevant emails
          </p>
        </div>
        
        {connectedAccounts.length > 1 && (
          <select
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            className="input-field w-auto"
          >
            <option value="all">All Accounts</option>
            {connectedAccounts.map(account => (
              <option key={account.id} value={account.id}>
                {account.email}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <div className="text-2xl font-bold text-blue-600">{stats.total_emails}</div>
          <div className="text-sm text-gray-600">Total Emails</div>
        </div>
        
        <div className="bg-green-50 p-4 rounded-lg border border-green-200">
          <div className="text-2xl font-bold text-green-600">{stats.conversation_emails}</div>
          <div className="text-sm text-gray-600">In Conversations</div>
          <div className="text-xs text-green-700 mt-1">
            {stats.conversation_percentage}% of total
          </div>
        </div>
        
        <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
          <div className="text-2xl font-bold text-yellow-600">{stats.valid_for_processing}</div>
          <div className="text-sm text-gray-600">Valid for Processing</div>
          <div className="text-xs text-yellow-700 mt-1">
            {stats.valid_processing_percentage}% of pending
          </div>
        </div>
        
        <div className="bg-red-50 p-4 rounded-lg border border-red-200">
          <div className="text-2xl font-bold text-red-600">{stats.filtering_impact.emails_filtered_out}</div>
          <div className="text-sm text-gray-600">Filtered Out</div>
          <div className="text-xs text-red-700 mt-1">
            {stats.filtering_impact.spam_reduction_percentage}% reduction
          </div>
        </div>
      </div>

      {/* Filtering Impact */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h4 className="text-lg font-semibold text-gray-900 mb-4">Filtering Impact</h4>
        
        <div className="space-y-4">
          {/* Progress bar showing conversation vs standalone emails */}
          <div>
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span>Email Types</span>
              <span>{stats.total_emails} total</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div className="flex h-full">
                <div 
                  className="bg-green-500 transition-all duration-300"
                  style={{ width: `${stats.conversation_percentage}%` }}
                  title={`${stats.conversation_emails} conversation emails`}
                ></div>
                <div 
                  className="bg-gray-400 transition-all duration-300"
                  style={{ width: `${100 - stats.conversation_percentage}%` }}
                  title={`${stats.standalone_emails} standalone emails`}
                ></div>
              </div>
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>🟢 Conversations ({stats.conversation_emails})</span>
              <span>⚪ Standalone ({stats.standalone_emails})</span>
            </div>
          </div>

          {/* Progress bar showing processing eligibility */}
          <div>
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span>Processing Eligibility</span>
              <span>{stats.pending_emails} pending</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div className="flex h-full">
                <div 
                  className="bg-blue-500 transition-all duration-300"
                  style={{ width: `${stats.valid_processing_percentage}%` }}
                  title={`${stats.valid_for_processing} valid for processing`}
                ></div>
                <div 
                  className="bg-red-400 transition-all duration-300"
                  style={{ width: `${100 - stats.valid_processing_percentage}%` }}
                  title={`${stats.filtering_impact.emails_filtered_out} filtered out`}
                ></div>
              </div>
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>🔵 Valid ({stats.valid_for_processing})</span>
              <span>🔴 Filtered ({stats.filtering_impact.emails_filtered_out})</span>
            </div>
          </div>
        </div>

        {/* Benefits */}
        <div className="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">
          <h5 className="font-medium text-green-900 mb-2">✅ Filtering Benefits</h5>
          <ul className="text-sm text-green-800 space-y-1">
            <li>• Reduces processing of spam and irrelevant emails by {stats.filtering_impact.spam_reduction_percentage}%</li>
            <li>• Focuses on emails with actual customer conversations</li>
            <li>• Improves FAQ quality by processing only relevant customer interactions</li>
            <li>• Saves AI processing costs by filtering out non-conversational emails</li>
          </ul>
        </div>
      </div>

      {/* Refresh Button */}
      <div className="text-center">
        <button
          onClick={loadStats}
          className="btn-secondary flex items-center space-x-2 mx-auto"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>Refresh Stats</span>
        </button>
      </div>
    </motion.div>
  );
};

export default EmailFilteringStats;