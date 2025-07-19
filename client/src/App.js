import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { io } from 'socket.io-client';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// Components
import Header from './components/Header';
import StepIndicator from './components/StepIndicator';
import EmailConnectionWizard from './components/EmailConnectionWizard';
import ProcessingStatus from './components/ProcessingStatus';
import FAQDisplay from './components/FAQDisplay';
import LoadingSpinner from './components/LoadingSpinner';
import FAQProcessor from './components/FAQProcessor';

// Services
import { apiService } from './services/apiService';

const STEPS = [
  { id: 1, title: 'Connect Email', description: 'Connect your Gmail or Outlook account' },
  { id: 2, title: 'Process Emails', description: 'AI analyzes your emails for questions' },
  { id: 3, title: 'Generate FAQs', description: 'View your automatically generated FAQs' }
];

function App() {
  const [currentStep, setCurrentStep] = useState(1);
  const [connectedAccounts, setConnectedAccounts] = useState([]);
  const [processingStatus, setProcessingStatus] = useState(null);
  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [socket, setSocket] = useState(null);

  // Check if this is an OAuth callback in a popup window - do this immediately
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get('success');
    const error = urlParams.get('error');
    const account = urlParams.get('account');
    
    console.log('OAuth callback check:', {
      url: window.location.href,
      hasOpener: !!window.opener,
      windowName: window.name,
      success,
      error,
      account,
      searchParams: window.location.search
    });
    
    // Check if we're in a popup by looking for window.opener or window name
    const isPopup = window.opener !== null || window.name === 'oauth';
    
    // If this is an OAuth callback in a popup
    if (isPopup && (success || error)) {
      // Show a message while closing
      document.body.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100vh; font-family: Arial, sans-serif;"><div style="text-align: center;"><h2>Authentication Complete</h2><p>This window will close automatically...</p></div></div>';
      
      if (success === 'gmail_connected' || success === 'outlook_connected') {
        // Try to notify the parent window if it exists
        if (window.opener && !window.opener.closed) {
          try {
            window.opener.postMessage({
              type: 'OAUTH_SUCCESS',
              provider: success.includes('gmail') ? 'gmail' : 'outlook',
              account: account
            }, window.location.origin);
          } catch (e) {
            console.error('Failed to post message to parent:', e);
          }
        }
      } else if (error) {
        // Try to notify the parent window about error
        if (window.opener && !window.opener.closed) {
          try {
            window.opener.postMessage({
              type: 'OAUTH_ERROR',
              error: error,
              details: urlParams.get('details')
            }, window.location.origin);
          } catch (e) {
            console.error('Failed to post message to parent:', e);
          }
        }
      }
      
      // Close the popup after a short delay
      setTimeout(() => {
        window.close();
        // If window.close() doesn't work, show instructions
        setTimeout(() => {
          if (!window.closed) {
            document.body.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100vh; font-family: Arial, sans-serif;"><div style="text-align: center;"><h2>Authentication Complete</h2><p>You can close this window now.</p></div></div>';
          }
        }, 500);
      }, 1000);
      
      // Don't render the React app
      return;
    }
    
    // If not in popup but has success params, handle the connection
    if (success && !window.opener) {
      if (success === 'gmail_connected' || success === 'outlook_connected') {
        // Store success info in sessionStorage to show toast after reload
        sessionStorage.setItem('oauth_success', JSON.stringify({
          provider: success.includes('gmail') ? 'Gmail' : 'Outlook',
          accountId: account
        }));
      }
      // Clear URL parameters and reload to properly initialize the app
      window.history.replaceState({}, document.title, window.location.pathname);
      window.location.reload();
    }
    
    // If not in popup but has error params, show error and clear URL
    if (error && !window.opener) {
      const errorMessage = error === 'token_exchange_failed'
        ? `OAuth error: ${urlParams.get('details') || 'Failed to exchange authorization code'}`
        : `Connection failed: ${error}`;
      toast.error(errorMessage);
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Initialize socket connection and load initial data
  useEffect(() => {
    
    // Check for OAuth success from sessionStorage
    const oauthSuccess = sessionStorage.getItem('oauth_success');
    if (oauthSuccess) {
      const { provider, accountId } = JSON.parse(oauthSuccess);
      toast.success(`${provider} account connected successfully!`);
      sessionStorage.removeItem('oauth_success');
      
      // Start email processing if we have the account ID
      if (accountId) {
        setTimeout(() => {
          apiService.startEmailProcessing(accountId).catch(error => {
            console.error('Failed to start email processing:', error);
          });
        }, 2000);
      }
    }
    
    const initializeApp = async () => {
      try {
        // Initialize socket connection with proper URL detection
        const getSocketUrl = () => {
          // If REACT_APP_SOCKET_URL is explicitly set, use it
          if (process.env.REACT_APP_SOCKET_URL) {
            return process.env.REACT_APP_SOCKET_URL;
          }
          
          // If REACT_APP_API_URL is set, use it for socket too
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
        
        const socketConnection = io(getSocketUrl());
        setSocket(socketConnection);

        // Set up socket event listeners
        socketConnection.on('processing_update', (data) => {
          setProcessingStatus(data);
          if (data.status === 'completed') {
            toast.success('Email processing completed!');
            loadFAQs();
          } else if (data.status === 'error') {
            toast.error(`Processing error: ${data.message}`);
          }
        });

        socketConnection.on('connect', () => {
          console.log('Connected to server');
        });

        socketConnection.on('disconnect', () => {
          console.log('Disconnected from server');
        });

        // Load initial data
        await loadConnectedAccounts();
        await loadFAQs();
        
        setLoading(false);
      } catch (error) {
        console.error('Failed to initialize app:', error);
        toast.error('Failed to connect to server');
        setLoading(false);
      }
    };

    initializeApp();

    // Cleanup socket connection on unmount
    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, []);

  // Load connected email accounts
  const loadConnectedAccounts = async () => {
    try {
      const accounts = await apiService.getConnectedAccounts();
      setConnectedAccounts(accounts);
      
      // If accounts exist, move to step 2 or 3 based on FAQ availability
      if (accounts.length > 0) {
        setCurrentStep(2);
      }
    } catch (error) {
      console.error('Failed to load connected accounts:', error);
    }
  };

  // Load FAQs
  const loadFAQs = async () => {
    try {
      const faqData = await apiService.getFAQs();
      setFaqs(faqData);
      
      // If FAQs exist, move to step 3
      if (faqData.length > 0) {
        setCurrentStep(3);
      }
    } catch (error) {
      console.error('Failed to load FAQs:', error);
    }
  };

  // Handle email account connection
  const handleAccountConnected = async (accountData) => {
    try {
      await loadConnectedAccounts();
      // Don't automatically move to step 2 - let user click Next
      toast.success(`${accountData.provider} account connected successfully! Click "Next Step" to continue.`);
      
      // Start email processing
      console.log('Starting email processing for account:', accountData.id);
      const result = await apiService.startEmailProcessing(accountData.id);
      console.log('Email processing started:', result);
    } catch (error) {
      console.error('Failed to handle account connection:', error);
      toast.error('Failed to start email processing: ' + error.message);
    }
  };

  // Handle account disconnection
  const handleAccountDisconnected = async (accountId) => {
    try {
      await apiService.disconnectAccount(accountId);
      await loadConnectedAccounts();
      toast.success('Account disconnected successfully');
      
      // Reset to step 1 if no accounts remain
      if (connectedAccounts.length <= 1) {
        setCurrentStep(1);
        setFaqs([]);
      }
    } catch (error) {
      console.error('Failed to disconnect account:', error);
      toast.error('Failed to disconnect account');
    }
  };

  // Handle manual email sync
  const handleSyncEmails = async () => {
    try {
      console.log('Starting email sync...');
      const result = await apiService.syncAllEmails();
      console.log('Sync result:', result);
      toast.success('Email sync started');
    } catch (error) {
      console.error('Failed to sync emails:', error);
      toast.error('Failed to start email sync');
    }
  };

  // Handle FAQ refresh
  const handleRefreshFAQs = async () => {
    try {
      await apiService.regenerateFAQs();
      toast.success('FAQ regeneration started');
    } catch (error) {
      console.error('Failed to regenerate FAQs:', error);
      toast.error('Failed to regenerate FAQs');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <LoadingSpinner size="large" />
      </div>
    );
  }

  // Check if we're in an OAuth popup after all hooks have been called
  const urlParams = new URLSearchParams(window.location.search);
  const isOAuthCallback = urlParams.get('success') || urlParams.get('error');
  const isPopup = window.opener !== null || window.name === 'oauth';
  
  // Don't render the main app if we're in an OAuth popup
  if (isPopup && isOAuthCallback) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Header />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Step Indicator */}
        <div className="mb-8">
          <StepIndicator steps={STEPS} currentStep={currentStep} />
        </div>

        {/* Debug Info - Remove in production */}
        <div className="mb-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200 text-sm text-gray-600">
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-medium">Debug Info:</span>
            <span>Step: <span className="font-semibold text-blue-600">{currentStep}</span></span>
            <span>Accounts: <span className="font-semibold text-green-600">{connectedAccounts.length}</span></span>
            <span>FAQs: <span className="font-semibold text-purple-600">{faqs.length}</span></span>
            {processingStatus && (
              <span>Status: <span className="font-semibold text-orange-600">{processingStatus.status}</span></span>
            )}
          </div>
        </div>

        {/* Main Content */}
        <AnimatePresence mode="wait">
          {currentStep === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <EmailConnectionWizard
                connectedAccounts={connectedAccounts}
                onAccountConnected={handleAccountConnected}
                onAccountDisconnected={handleAccountDisconnected}
              />
            </motion.div>
          )}

          {currentStep === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              {connectedAccounts.length > 0 ? (
                <div className="space-y-6">
                  <ProcessingStatus
                    status={processingStatus}
                    connectedAccounts={connectedAccounts}
                    onSyncEmails={handleSyncEmails}
                    onContinue={() => setCurrentStep(3)}
                    canContinue={faqs.length > 0}
                  />
                  <FAQProcessor
                    socket={socket}
                    onProcessingComplete={(result) => {
                      // Reload FAQs after processing completes
                      loadFAQs();
                      toast.success(`Processing complete! Found ${result.questionsFound} questions and created ${result.faqGroupsCreated} FAQ groups.`);
                    }}
                  />
                </div>
              ) : (
                <div className="text-center p-8">
                  <p className="text-gray-600">No connected accounts found. Please go back and connect an email account.</p>
                </div>
              )}
            </motion.div>
          )}

          {currentStep === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <FAQDisplay
                faqs={faqs}
                connectedAccounts={connectedAccounts}
                onRefreshFAQs={handleRefreshFAQs}
                onBackToProcessing={() => setCurrentStep(2)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Navigation */}
        <div className="mt-12 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <button
              onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
              disabled={currentStep === 1}
              className="w-full sm:w-auto btn-secondary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 px-6 py-3"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16l-4-4m0 0l4-4m-4 4h18" />
              </svg>
              <span>Previous Step</span>
            </button>
            
            <div className="hidden sm:flex items-center space-x-2 text-sm text-gray-500">
              <span>Step {currentStep} of {STEPS.length}</span>
            </div>
            
            <button
              onClick={() => {
                const nextStep = Math.min(3, currentStep + 1);
                console.log('Moving from step', currentStep, 'to step', nextStep);
                setCurrentStep(nextStep);
              }}
              disabled={currentStep === 3 || (currentStep === 1 && connectedAccounts.length === 0) || (currentStep === 2 && faqs.length === 0)}
              className="w-full sm:w-auto btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 px-6 py-3"
            >
              <span>
                {currentStep === 1 && connectedAccounts.length > 0 ? 'Continue to Processing' :
                 currentStep === 2 && faqs.length > 0 ? 'View Generated FAQs' :
                 currentStep === 3 ? 'Complete' : 'Next Step'}
              </span>
              {currentStep < 3 && (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </main>

      {/* Toast Notifications */}
      <ToastContainer
        position="top-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
      />
    </div>
  );
}

export default App;