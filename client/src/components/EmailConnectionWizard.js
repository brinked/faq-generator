import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import { apiService } from '../services/apiService';
import LoadingSpinner, { ButtonSpinner } from './LoadingSpinner';

const EmailConnectionWizard = ({ connectedAccounts, onAccountConnected, onAccountDisconnected }) => {
  const [connecting, setConnecting] = useState(null);
  const [showConfirmDisconnect, setShowConfirmDisconnect] = useState(null);

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

      // Listen for OAuth callback
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          setConnecting(null);
          
          // Check if account was successfully connected
          setTimeout(async () => {
            try {
              const accounts = await apiService.getConnectedAccounts();
              const newAccount = accounts.find(acc => 
                acc.provider === provider && 
                !connectedAccounts.find(existing => existing.id === acc.id)
              );
              
              if (newAccount) {
                onAccountConnected(newAccount);
              }
            } catch (error) {
              console.error('Failed to check connected accounts:', error);
            }
          }, 1000);
        }
      }, 1000);

      // Handle OAuth message from popup
      const handleMessage = (event) => {
        console.log('Received message:', event.data, 'from origin:', event.origin);
        
        if (event.origin !== window.location.origin) {
          console.log('Ignoring message from different origin');
          return;
        }
        
        if (event.data.type === 'OAUTH_SUCCESS') {
          console.log('OAuth success message received');
          if (popup && !popup.closed) {
            popup.close();
          }
          clearInterval(checkClosed);
          setConnecting(null);
          
          // Reload accounts to get the newly connected account
          setTimeout(async () => {
            try {
              const accounts = await apiService.getConnectedAccounts();
              const newAccount = accounts.find(acc =>
                acc.provider === event.data.provider &&
                !connectedAccounts.find(existing => existing.id === acc.id)
              );
              
              if (newAccount) {
                onAccountConnected(newAccount);
              } else if (event.data.account) {
                // If we have the account ID, find it in the accounts list
                const allAccounts = await apiService.getConnectedAccounts();
                const connectedAccount = allAccounts.find(acc => acc.id === event.data.account);
                if (connectedAccount) {
                  onAccountConnected(connectedAccount);
                }
              }
            } catch (error) {
              console.error('Failed to check connected accounts:', error);
              toast.error('Account connected but failed to load details');
            }
          }, 500);
        } else if (event.data.type === 'OAUTH_ERROR') {
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