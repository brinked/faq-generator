import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import { apiService } from '../services/apiService';
import { ButtonSpinner } from './LoadingSpinner';

const EmailConnectionWizard = ({ connectedAccounts, onAccountConnected, onAccountDisconnected }) => {
  const [connecting, setConnecting] = useState(null);
  const [showConfirmDisconnect, setShowConfirmDisconnect] = useState(null);
  const [processingStatus, setProcessingStatus] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const [fetchMoreStates, setFetchMoreStates] = useState({});
  const [pageTokens, setPageTokens] = useState({});

  // Poll for processing status when there are connected accounts
  useEffect(() => {
    if (connectedAccounts.length === 0) return;

    let pollingInterval;

    const startPolling = () => {
      setIsPolling(true);
      pollingInterval = setInterval(async () => {
        try {
          const status = await apiService.getProcessingStatus();
          setProcessingStatus(status);

          // Stop polling if no active jobs
          const hasActiveJobs = status.accounts?.some(acc =>
            acc.current_job && acc.current_job.status === 'processing'
          );

          if (!hasActiveJobs) {
            setIsPolling(false);
            clearInterval(pollingInterval);
          }
        } catch (error) {
          console.error('Failed to poll processing status:', error);
        }
      }, 2000);
    };

    const stopPolling = () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
        setIsPolling(false);
      }
    };

    // Check if there are any active processing jobs
    if (processingStatus?.accounts) {
      const hasActiveJobs = processingStatus.accounts.some(acc =>
        acc.current_job && acc.current_job.status === 'processing'
      );

      if (hasActiveJobs && !isPolling) {
        startPolling();
      } else if (!hasActiveJobs && isPolling) {
        stopPolling();
      }
    }

    return () => {
      stopPolling();
    };
  }, [connectedAccounts, processingStatus, isPolling]);

  // Load initial processing status
  useEffect(() => {
    if (connectedAccounts.length > 0) {
      const loadStatus = async () => {
        try {
          const status = await apiService.getProcessingStatus();
          setProcessingStatus(status);
        } catch (error) {
          console.error('Failed to load processing status:', error);
        }
      };
      loadStatus();
    }
  }, [connectedAccounts]);

  // Handle fetch more emails for a specific account
  const handleFetchMore = async (accountId, accountEmail) => {
    try {
      const currentState = fetchMoreStates[accountId] || {};
      if (currentState.fetching) return; // Prevent multiple requests

      setFetchMoreStates(prev => ({
        ...prev,
        [accountId]: { ...currentState, fetching: true }
      }));

      toast.info(`Fetching more emails...`);

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
          toast.success(`Fetched ${synced} more emails`);
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

  const handleConnectEmail = async (provider) => {
    setConnecting(provider);

    try {
      console.log(`Starting OAuth flow for ${provider}`);

      let authUrl;
      if (provider === 'gmail') {
        authUrl = await apiService.getGmailAuthUrl();
      } else if (provider === 'outlook') {
        authUrl = await apiService.getOutlookAuthUrl();
      }

      console.log(`OAuth URL received:`, authUrl);

      // Open OAuth popup
      const popup = window.open(
        authUrl,
        'oauth',
        'width=500,height=600,scrollbars=yes,resizable=yes'
      );

      console.log(`OAuth popup opened:`, popup ? 'success' : 'failed');

      // Helper: poll for new account after OAuth completes
      const pollForNewAccount = async ({ expectedProvider, expectedEmail = null, expectedAccountId = null, maxAttempts = 10, delayMs = 1000 }) => {
        let attempts = 0;
        const initialIds = new Set((connectedAccounts || []).map(acc => acc.id));
        while (attempts < maxAttempts) {
          try {
            const accounts = await apiService.getConnectedAccounts();
            // Prefer matching by accountId if provided
            let match = null;
            if (expectedAccountId) {
              match = accounts.find(acc => acc.id === expectedAccountId);
            }
            if (!match) {
              match = accounts.find(acc => {
                const isNew = !initialIds.has(acc.id);
                const providerMatch = acc.provider === expectedProvider;
                const emailMatch = expectedEmail ? acc.email === expectedEmail : true;
                return isNew && providerMatch && emailMatch;
              });
            }
            if (match) {
              onAccountConnected(match);
              return true;
            }
          } catch (e) {
            // ignore and retry
          }
          attempts += 1;
          await new Promise(r => setTimeout(r, delayMs));
        }
        return false;
      };

      // Listen for OAuth callback
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          setConnecting(null);

          // After popup closes, poll a few times to detect the newly added account
          // This handles timing where DB update may lag the UI
          pollForNewAccount({ expectedProvider: provider }).then(found => {
            if (!found) {
              console.warn('OAuth account not detected after polling');
            }
          });
        }
      }, 1000);

      // Handle OAuth message from popup
      const handleMessage = (event) => {
        console.log('Received message:', event.data, 'from origin:', event.origin);

        // Accept messages regardless of exact origin to avoid cross-origin issues in deployments
        if (!event.data || !event.data.type) return;

        const type = String(event.data.type).toLowerCase();

        if (type === 'oauth_complete' || type === 'oauth_success') {
          console.log('OAuth success message received');
          if (popup && !popup.closed) {
            popup.close();
          }
          clearInterval(checkClosed);
          setConnecting(null);

          // Reload accounts to get the newly connected account
          const expectedProvider = event.data.provider || provider;
          const expectedEmail = event.data.email || null;
          const expectedAccountId = event.data.account || null;
          pollForNewAccount({ expectedProvider, expectedEmail, expectedAccountId })
            .then(found => {
              if (!found) {
                console.warn('OAuth account not detected after message polling');
              }
            })
            .catch(() => {
              toast.error('Account connected but failed to load details');
            });
        } else if (type === 'oauth_error') {
          console.log('OAuth error message received:', event.data);
          if (popup && !popup.closed) {
            popup.close();
          }
          clearInterval(checkClosed);
          setConnecting(null);
          const errorMessage = event.data.details || event.data.error || 'Authentication failed';
          toast.error(errorMessage);
        }
      };

      window.addEventListener('message', handleMessage);

      // Cleanup
      setTimeout(() => {
        window.removeEventListener('message', handleMessage);
        if (!popup.closed) {
          popup.close();
          setConnecting(null);
        }
      }, 300000); // 5 minute timeout

    } catch (error) {
      console.error('Failed to initiate OAuth:', error);
      toast.error('Failed to start authentication process');
      setConnecting(null);
    }
  };

  const handleDisconnectAccount = async (accountId) => {
    try {
      await onAccountDisconnected(accountId);
      setShowConfirmDisconnect(null);
    } catch (error) {
      console.error('Failed to disconnect account:', error);
    }
  };

  const getProviderIcon = (provider) => {
    if (provider === 'gmail') {
      return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-.904.732-1.636 1.636-1.636h3.819l6.545 4.91 6.545-4.91h3.819A1.636 1.636 0 0 1 24 5.457z"/>
        </svg>
      );
    } else if (provider === 'outlook') {
      return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
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
    <div className="max-w-4xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center mb-8"
      >
        <h2 className="text-3xl font-bold text-gray-900 mb-4">
          Connect Your Email Account
        </h2>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Connect your Gmail or Outlook account to start analyzing your emails and generating FAQs automatically.
        </p>
      </motion.div>

      {/* Connected Accounts */}
      {connectedAccounts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-8"
        >
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Connected Accounts</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {connectedAccounts.map((account) => (
              <motion.div
                key={account.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="card flex items-center justify-between"
              >
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
                    <span>Connected</span>
                  </div>
                  <button
                    onClick={() => setShowConfirmDisconnect(account.id)}
                    className="text-gray-400 hover:text-red-600 transition-colors duration-200"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Email Processing Progress */}
      {processingStatus?.accounts && processingStatus.accounts.some(acc =>
        acc.current_job && acc.current_job.status === 'processing'
      ) && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="card mb-8 bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200"
        >
          <div className="flex items-center space-x-3 mb-4">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-blue-900">Email Processing in Progress</h3>
              <p className="text-sm text-blue-700">Your emails are being fetched and analyzed</p>
            </div>
          </div>

          <div className="space-y-4">
            {processingStatus.accounts
              .filter(acc => acc.current_job && acc.current_job.status === 'processing')
              .map((account) => (
                <div key={account.id} className="bg-white rounded-lg p-4 border border-blue-200">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center space-x-2">
                      <div className={`${getProviderColor(account.provider)}`}>
                        {getProviderIcon(account.provider)}
                      </div>
                      <span className="font-medium text-gray-900">{account.email_address}</span>
                    </div>
                    <span className="text-sm font-medium text-blue-600">
                      {account.current_job.progress}%
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-blue-200 rounded-full h-2 mb-3">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${account.current_job.progress}%` }}
                      transition={{ duration: 0.5 }}
                      className="bg-blue-600 h-2 rounded-full"
                    />
                  </div>

                  {/* Progress Details */}
                  <div className="flex justify-between text-sm text-blue-700">
                    <span>
                      {account.current_job.processed_items} of {account.current_job.total_items} emails processed
                    </span>
                    <span>
                      Started {new Date(account.current_job.started_at).toLocaleTimeString()}
                    </span>
                  </div>

                  {/* Email Counts */}
                  {account.email_stats && (
                    <div className="mt-3 pt-3 border-t border-blue-200">
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <div className="text-lg font-semibold text-gray-900">
                            {account.email_stats.total}
                          </div>
                          <div className="text-xs text-gray-500">Total Emails</div>
                        </div>
                        <div>
                          <div className="text-lg font-semibold text-green-600">
                            {account.email_stats.processed}
                          </div>
                          <div className="text-xs text-gray-500">Processed</div>
                        </div>
                        <div>
                          <div className="text-lg font-semibold text-orange-600">
                            {account.email_stats.pending}
                          </div>
                          <div className="text-xs text-gray-500">Pending</div>
                        </div>
                      </div>

                      {/* Fetch More Button */}
                      <div className="mt-4 pt-3 border-t border-blue-200">
                        <div className="flex items-center justify-between">
                          <div className="text-sm text-blue-700">
                            {fetchMoreStates[account.id]?.lastMessage || 'Ready to fetch more emails'}
                          </div>
                          <button
                            onClick={() => handleFetchMore(account.id, account.email_address)}
                            disabled={fetchMoreStates[account.id]?.fetching}
                            className="btn-primary px-3 py-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {fetchMoreStates[account.id]?.fetching ? (
                              <>
                                <ButtonSpinner />
                                <span className="ml-1">Fetching...</span>
                              </>
                            ) : (
                              <>
                                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                Fetch More
                              </>
                            )}
                          </button>
                        </div>

                        {/* Fetch More Progress */}
                        {fetchMoreStates[account.id]?.fetching && (
                          <div className="mt-2">
                            <div className="flex items-center space-x-2 text-xs text-blue-600">
                              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                              <span>Fetching more emails...</span>
                            </div>
                          </div>
                        )}

                        {/* Last Fetch Result */}
                        {fetchMoreStates[account.id]?.lastFetchCount && (
                          <div className="mt-2 text-xs text-green-600">
                            +{fetchMoreStates[account.id].lastFetchCount} emails fetched
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
          </div>

          {isPolling && (
            <div className="mt-4 pt-4 border-t border-blue-200">
              <div className="flex items-center space-x-2 text-sm text-blue-600">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                <span>Live updates enabled - refreshing every 2 seconds</span>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Connection Options */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="grid gap-6 md:grid-cols-2"
      >
        {/* Gmail Connection */}
        <div className="card hover:shadow-md transition-shadow duration-200">
          <div className="flex items-center space-x-4 mb-4">
            <div className="flex items-center justify-center w-12 h-12 bg-red-50 rounded-lg text-red-600">
              {getProviderIcon('gmail')}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Gmail</h3>
              <p className="text-sm text-gray-600">Connect your Google account</p>
            </div>
          </div>
          <p className="text-gray-600 mb-6">
            Access your Gmail inbox to analyze customer emails and generate relevant FAQs.
          </p>
          <button
            onClick={() => handleConnectEmail('gmail')}
            disabled={connecting === 'gmail'}
            className="btn-primary w-full flex items-center justify-center space-x-2"
          >
            {connecting === 'gmail' ? (
              <>
                <ButtonSpinner />
                <span>Connecting...</span>
              </>
            ) : (
              <>
                <span>Connect Gmail</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </>
            )}
          </button>
        </div>

        {/* Outlook Connection */}
        <div className="card hover:shadow-md transition-shadow duration-200">
          <div className="flex items-center space-x-4 mb-4">
            <div className="flex items-center justify-center w-12 h-12 bg-blue-50 rounded-lg text-blue-600">
              {getProviderIcon('outlook')}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Outlook</h3>
              <p className="text-sm text-gray-600">Connect your Microsoft account</p>
            </div>
          </div>
          <p className="text-gray-600 mb-6">
            Access your Outlook inbox to analyze customer emails and generate relevant FAQs.
          </p>
          <button
            onClick={() => handleConnectEmail('outlook')}
            disabled={connecting === 'outlook'}
            className="btn-primary w-full flex items-center justify-center space-x-2"
          >
            {connecting === 'outlook' ? (
              <>
                <ButtonSpinner />
                <span>Connecting...</span>
              </>
            ) : (
              <>
                <span>Connect Outlook</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </>
            )}
          </button>
        </div>
      </motion.div>

      {/* Security Notice */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="mt-8 p-4 bg-blue-50 rounded-lg border border-blue-200"
      >
        <div className="flex items-start space-x-3">
          <svg className="w-5 h-5 text-blue-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <div>
            <h4 className="font-medium text-blue-900 mb-1">Your data is secure</h4>
            <p className="text-sm text-blue-700">
              We use OAuth 2.0 for secure authentication. Your email credentials are never stored on our servers.
              We only access emails to analyze questions and generate FAQs.
            </p>
          </div>
        </div>
      </motion.div>

      {/* Disconnect Confirmation Modal */}
      <AnimatePresence>
        {showConfirmDisconnect && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            onClick={() => setShowConfirmDisconnect(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-lg p-6 max-w-md mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Disconnect Account
              </h3>
              <p className="text-gray-600 mb-6">
                Are you sure you want to disconnect this email account? This will stop email analysis and FAQ generation for this account.
              </p>
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowConfirmDisconnect(null)}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDisconnectAccount(showConfirmDisconnect)}
                  className="btn-primary bg-red-600 hover:bg-red-700 flex-1"
                >
                  Disconnect
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default EmailConnectionWizard;
