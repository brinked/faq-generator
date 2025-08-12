import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import LoadingSpinner, { LoadingDots } from './LoadingSpinner';
import EmailFilteringStats from './EmailFilteringStats';
import { apiService } from '../services/apiService';
import { toast } from 'react-toastify';

const ProcessingStatus = ({ status, connectedAccounts, onSyncEmails, onContinue, canContinue }) => {
  const [localStatus, setLocalStatus] = useState(status);
  const [showDetails, setShowDetails] = useState(false);
  const [processingAccounts, setProcessingAccounts] = useState([]);
  const [fetchMoreStates, setFetchMoreStates] = useState({});
  const [pageTokens, setPageTokens] = useState({});

  useEffect(() => {
    setLocalStatus(status);
  }, [status]);

  useEffect(() => {
    if (status?.accounts) {
      const processing = status.accounts.filter(acc => 
        acc.current_job && acc.current_job.status === 'processing'
      );
      setProcessingAccounts(processing);
    }
  }, [status]);

  // Handle fetch more emails for a specific account
  const handleFetchMore = async (accountId, accountEmail) => {
    try {
      const currentState = fetchMoreStates[accountId] || {};
      if (currentState.fetching) return; // Prevent multiple requests

      setFetchMoreStates(prev => ({
        ...prev,
        [accountId]: { ...currentState, fetching: true }
      }));

      toast.info(`Fetching more emails for ${accountEmail}...`);

      const result = await apiService.fetchMoreEmails(accountId, {
        maxEmails: 100, // Fetch in smaller chunks of 100 emails
        pageToken: pageTokens[accountId] || null
      });

      if (result.success) {
        const { hasMore, nextPageToken, message, synced } = result.result;
        
        // Update page token for next fetch
        if (nextPageToken) {
          setPageTokens(prev => ({
            ...prev,
            [accountId]: nextPageToken
          }));
        }

        // Update fetch more state
        setFetchMoreStates(prev => ({
          ...prev,
          [accountId]: {
            ...currentState,
            fetching: false,
            hasMore,
            lastFetchCount: synced,
            lastMessage: message
          }
        }));

        if (synced > 0) {
          toast.success(`Fetched ${synced} more emails from ${accountEmail}`);
        } else {
          toast.info(message || 'No more emails to fetch');
        }

        // Refresh the processing status to show updated counts
        if (typeof onSyncEmails === 'function') {
          // Trigger a refresh of the status
          setTimeout(() => {
            window.location.reload(); // Simple refresh for now
          }, 2000);
        }
      } else {
        // Handle API error response
        toast.error(`Failed to fetch more emails: ${result.message || 'Unknown error'}`);
        
        setFetchMoreStates(prev => ({
          ...prev,
          [accountId]: { ...prev[accountId], fetching: false }
        }));
      }
    } catch (error) {
      console.error('Failed to fetch more emails:', error);
      toast.error(`Failed to fetch more emails: ${error.message || 'Network error'}`);
      
      // Always reset fetching state on error
      setFetchMoreStates(prev => ({
        ...prev,
        [accountId]: { 
          ...prev[accountId], 
          fetching: false,
          lastMessage: 'Failed to fetch emails'
        }
      }));
    }
  };

  const getStatusColor = (statusType) => {
    switch (statusType) {
      case 'processing':
      case 'in_progress':
        return 'text-primary-600';
      case 'completed':
      case 'success':
        return 'text-success-600';
      case 'error':
      case 'failed':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  const getStatusIcon = (statusType) => {
    switch (statusType) {
      case 'processing':
      case 'in_progress':
        return (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="w-5 h-5"
          >
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </motion.div>
        );
      case 'completed':
      case 'success':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'error':
      case 'failed':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      default:
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  const formatStatusMessage = (status) => {
    if (!status) return 'Ready to process emails';
    
    switch (status.status) {
      case 'processing':
        return status.message || 'Processing emails...';
      case 'completed':
        return status.message || 'Email processing completed successfully';
      case 'error':
        return status.message || 'An error occurred during processing';
      default:
        return status.message || 'Processing status unknown';
    }
  };

  const getProgressPercentage = () => {
    if (!localStatus || !localStatus.progress) return 0;
    return Math.min(100, Math.max(0, localStatus.progress.percentage || 0));
  };

  const formatEmailCount = (count) => {
    if (count === 0) return '0';
    if (count < 1000) return count.toString();
    return `${(count / 1000).toFixed(1)}k`;
  };

  const getProviderIcon = (provider) => {
    if (provider === 'gmail') {
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-.904.732-1.636 1.636-1.636h3.819l6.545 4.91 6.545-4.91h3.819A1.636 1.636 0 0 1 24 5.457z"/>
        </svg>
      );
    } else if (provider === 'outlook') {
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7.88 12.04q0 .45-.11.87-.1.41-.33.74-.22.33-.58.52-.37.2-.87.2t-.85-.2q-.35-.21-.57-.55-.22-.33-.33-.75-.1-.42-.1-.86t.1-.87q.1-.43.34-.76.22-.34.59-.54.36-.2.87-.2t.86.2q.35.21.57.55.22.34.31.77.1.43.1.88zM1.14 8.2h5.25c.54 0 .97.43.97.97v7.66c0 .54-.43.97-.97.97H1.14c-.54 0-.97-.43-.97-.97V9.17c0-.54.43-.97.97-.97zm6.2-6.7h7.65c.54 0 .97.43.97.97v6.36c0 .54-.43.97-.97.97H7.34c-.54 0-.97-.43-.97-.97V2.47c0-.54.43-.97.97-.97zm8.3 8.15h7.32c.54 0 .97.43.97.97v7.4c0 .54-.43.97-.97.97h-7.32c-.54 0-.97-.43-.97-.97v-7.4c0-.54.43-.97.97-.97z"/>
        </svg>
      );
    }
    return null;
  };

  const getProviderColor = (provider) => {
    return provider === 'gmail' ? 'text-red-600' : 'text-blue-600';
  };

  return (
    <div className="max-w-6xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center mb-8"
      >
        <h2 className="text-3xl font-bold text-gray-900 mb-4">
          Email Processing & Analytics
        </h2>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Monitor your email processing progress and view detailed analytics across all connected accounts.
        </p>
      </motion.div>

      {/* Overall Statistics */}
      {localStatus?.overall_stats && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8"
        >
          <div className="card text-center p-4">
            <div className="text-2xl font-bold text-blue-600 mb-1">
              {formatEmailCount(localStatus.overall_stats.total_emails)}
            </div>
            <div className="text-sm text-gray-600">Total Emails</div>
          </div>
          <div className="card text-center p-4">
            <div className="text-2xl font-bold text-green-600 mb-1">
              {formatEmailCount(localStatus.overall_stats.processed_emails)}
            </div>
            <div className="text-sm text-gray-600">Processed</div>
          </div>
          <div className="card text-center p-4">
            <div className="text-2xl font-bold text-orange-600 mb-1">
              {formatEmailCount(localStatus.overall_stats.pending_emails)}
            </div>
            <div className="text-sm text-gray-600">Pending</div>
          </div>
          <div className="card text-center p-4">
            <div className="text-2xl font-bold text-purple-600 mb-1">
              {formatEmailCount(localStatus.overall_stats.customer_questions)}
            </div>
            <div className="text-sm text-gray-600">Questions Found</div>
          </div>
        </motion.div>
      )}

      {/* Connected Accounts with Detailed Status */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="card mb-8"
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Connected Accounts Status</h3>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-sm text-primary-600 hover:text-primary-700 transition-colors duration-200"
          >
            {showDetails ? 'Hide Details' : 'Show Details'}
          </button>
        </div>

        <div className="space-y-4">
          {connectedAccounts.map((account) => {
            const accountStatus = localStatus?.accounts?.find(acc => acc.id === account.id);
            const currentJob = accountStatus?.current_job;
            const emailStats = accountStatus?.email_stats;
            const questionStats = accountStatus?.question_stats;
            const fetchMoreState = fetchMoreStates[account.id] || {};

            return (
              <div key={account.id} className="border border-gray-200 rounded-lg p-4">
                {/* Account Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <div className={`${getProviderColor(account.provider)}`}>
                      {getProviderIcon(account.provider)}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{account.email}</p>
                      <p className="text-sm text-gray-500 capitalize">{account.provider}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="flex items-center space-x-1 text-sm text-success-600">
                      <div className="w-2 h-2 bg-success-500 rounded-full"></div>
                      <span>Active</span>
                    </div>
                  </div>
                </div>

                {/* Email Statistics */}
                {emailStats && (
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="text-center">
                      <div className="text-lg font-semibold text-gray-900">
                        {formatEmailCount(emailStats.total)}
                      </div>
                      <div className="text-xs text-gray-500">Total Emails</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-green-600">
                        {formatEmailCount(emailStats.processed)}
                      </div>
                      <div className="text-xs text-gray-500">Processed</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-orange-600">
                        {formatEmailCount(emailStats.pending)}
                      </div>
                      <div className="text-xs text-gray-500">Pending</div>
                    </div>
                  </div>
                )}

                {/* Current Processing Job */}
                {currentJob && currentJob.status === 'processing' && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-2">
                        <LoadingSpinner size="small" />
                        <span className="font-medium text-blue-900">
                          Processing {currentJob.type === 'email_sync' ? 'Emails' : 'Content'}
                        </span>
                      </div>
                      <span className="text-sm text-blue-600 font-medium">
                        {currentJob.progress}%
                      </span>
                    </div>
                    
                    {/* Progress Bar */}
                    <div className="w-full bg-blue-200 rounded-full h-2 mb-2">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${currentJob.progress}%` }}
                        transition={{ duration: 0.5 }}
                        className="bg-blue-600 h-2 rounded-full"
                      />
                    </div>
                    
                    {/* Progress Details */}
                    <div className="flex justify-between text-sm text-blue-700">
                      <span>
                        {currentJob.processed_items} of {currentJob.total_items} items processed
                      </span>
                      <span>
                        Started {new Date(currentJob.started_at).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                )}

                {/* Fetch More Section */}
                {emailStats && emailStats.total > 0 && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="font-medium text-gray-900">Email Sync Status</h4>
                        <p className="text-sm text-gray-600">
                          {fetchMoreState.lastMessage || 'Ready to fetch more emails'}
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        {fetchMoreState.lastFetchCount && (
                          <span className="text-sm text-green-600 font-medium">
                            +{fetchMoreState.lastFetchCount} emails
                          </span>
                        )}
                        <button
                          onClick={() => handleFetchMore(account.id, account.email)}
                          disabled={fetchMoreState.fetching}
                          className="btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {fetchMoreState.fetching ? (
                            <>
                              <LoadingSpinner size="small" />
                              <span className="ml-2">Fetching...</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              Fetch More
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                    
                    {/* Fetch More Progress */}
                    {fetchMoreState.fetching && (
                      <div className="mt-3">
                        <div className="flex items-center space-x-2 text-sm text-blue-600">
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                          <span>Fetching more emails from {account.provider}...</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Question Statistics */}
                {questionStats && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center">
                      <div className="text-lg font-semibold text-purple-600">
                        {formatEmailCount(questionStats.total)}
                      </div>
                      <div className="text-xs text-gray-500">Total Questions</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-indigo-600">
                        {formatEmailCount(questionStats.customer)}
                      </div>
                      <div className="text-xs text-gray-500">Customer Questions</div>
                    </div>
                  </div>
                )}

                {/* Last Sync Info */}
                {accountStatus?.last_sync_at && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <p className="text-xs text-gray-500">
                      Last synced: {new Date(accountStatus.last_sync_at).toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Email Filtering Statistics */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="card mb-8"
      >
        <EmailFilteringStats connectedAccounts={connectedAccounts} />
      </motion.div>

      {/* Actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="flex flex-col sm:flex-row gap-4"
      >
        <button
          onClick={onSyncEmails}
          disabled={processingAccounts.length > 0}
          className="btn-secondary flex items-center justify-center space-x-2 flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>
            {processingAccounts.length > 0 
              ? `Processing ${processingAccounts.length} account(s)...` 
              : 'Sync All Emails'
            }
          </span>
        </button>

        <button
          onClick={onContinue}
          disabled={!canContinue}
          className="btn-primary flex items-center justify-center space-x-2 flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span>View Generated FAQs</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </motion.div>

      {/* Processing Animation */}
      {processingAccounts.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed bottom-8 right-8 bg-white rounded-lg shadow-lg p-4 border border-gray-200"
        >
          <div className="flex items-center space-x-3">
            <LoadingSpinner size="small" />
            <div>
              <p className="text-sm font-medium text-gray-900">
                Processing {processingAccounts.length} account(s)...
              </p>
              <p className="text-xs text-gray-500">
                {processingAccounts.map(acc => acc.email_address).join(', ')}
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default ProcessingStatus;