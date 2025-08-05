import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { io } from 'socket.io-client';
import { toast } from 'react-toastify';

import Header from './Header';
import StepIndicator from './StepIndicator';
import EmailConnectionWizard from './EmailConnectionWizard';
import ProcessingStatus from './ProcessingStatus';
import FAQDisplay from './FAQDisplay';
import AdminFAQManager from './AdminFAQManager';
import SettingsModal from './SettingsModal';
import LoadingSpinner from './LoadingSpinner';
import FAQProcessor from './FAQProcessor';

import { apiService } from '../services/apiService';

const STEPS = [
  { id: 1, title: 'Connect Email', description: 'Connect your Gmail or Outlook account' },
  { id: 2, title: 'Process Emails', description: 'AI analyzes your emails for questions' },
  { id: 3, title: 'Generate FAQs', description: 'View your automatically generated FAQs' },
  { id: 4, title: 'Manage FAQs', description: 'Edit, sort, and manage your FAQs' }
];

const AdminDashboard = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [connectedAccounts, setConnectedAccounts] = useState([]);
  const [processingStatus, setProcessingStatus] = useState(null);
  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [socket, setSocket] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();


  useEffect(() => {
    const checkAuth = async () => {
      try {
        if (!apiService.isAuthenticated()) {
          navigate('/admin/login');
          return;
        }

        const data = await apiService.getAuthStatus();

        if (data.authenticated) {
          setIsAuthenticated(true);
          setUser(data.user);
        } else {
          apiService.setToken(null);
          navigate('/admin/login');
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        apiService.setToken(null);
        navigate('/admin/login');
      }
    };

    checkAuth();
  }, [navigate]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const urlParams = new URLSearchParams(location.search);
    const success = urlParams.get('success');
    const error = urlParams.get('error');
    const provider = urlParams.get('provider');
    const email = urlParams.get('email');
    const message = urlParams.get('message');

    if (success === 'true' && provider && email) {
      toast.success(`${provider.charAt(0).toUpperCase() + provider.slice(1)} account connected successfully! (${email})`);
      // Clear the URL parameters
      navigate('/admin/dashboard', { replace: true });
      // Refresh accounts to show the new connection
      loadConnectedAccounts();
    } else if (error) {
      const errorMessage = message || 'OAuth connection failed';
      toast.error(`OAuth Error: ${errorMessage}`);
      // Clear the URL parameters
      navigate('/admin/dashboard', { replace: true });
    }

    // Listen for messages from OAuth popup
    const handleOAuthMessage = (event) => {
      if (event.data && event.data.type === 'oauth_complete') {
        const { success, provider, email, error } = event.data;

        if (success && provider) {
          toast.success(`${provider.charAt(0).toUpperCase() + provider.slice(1)} account connected successfully!${email ? ` (${email})` : ''}`);
          // Refresh accounts to show the new connection
          loadConnectedAccounts();
        } else if (error) {
          toast.error(`OAuth Error: ${error}`);
        }
      }
    };

    window.addEventListener('message', handleOAuthMessage);

    return () => {
      window.removeEventListener('message', handleOAuthMessage);
    };
  }, [isAuthenticated, location.search, navigate]);

  // Initialize app after authentication
  useEffect(() => {
    if (!isAuthenticated) return;

    const initializeApp = async () => {
      try {
        // Initialize socket connection
        const getSocketUrl = () => {
          if (process.env.REACT_APP_SOCKET_URL) {
            return process.env.REACT_APP_SOCKET_URL;
          }
          if (process.env.REACT_APP_API_URL) {
            return process.env.REACT_APP_API_URL;
          }
          if (process.env.NODE_ENV === 'production') {
            return window.location.origin;
          }
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
  }, [isAuthenticated]);

  // Load connected email accounts
  const loadConnectedAccounts = async () => {
    try {
      const accounts = await apiService.getConnectedAccounts();
      setConnectedAccounts(accounts);

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
      toast.success(`${accountData.provider} account connected successfully! Click "Next Step" to continue.`);

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
      const result = await apiService.syncAllEmails();
      toast.success('Email sync started');
    } catch (error) {
      console.error('Failed to sync emails:', error);
      toast.error('Failed to start email sync');
    }
  };

  // Handle FAQ refresh
  const handleRefreshFAQs = async () => {
    try {
      await loadFAQs();
      toast.success('FAQs refreshed successfully');
    } catch (error) {
      console.error('Failed to refresh FAQs:', error);
      toast.error('Failed to refresh FAQs');
    }
  };

  // Handle logout
  const handleLogout = async () => {
    try {
      await apiService.logout();
      setIsAuthenticated(false);
      setUser(null);
      navigate('/admin/login');
      toast.success('Logged out successfully');
    } catch (error) {
      console.error('Logout failed:', error);
      toast.error('Logout failed');
    }
  };

  if (!isAuthenticated) {
    return <LoadingSpinner size="large" />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <LoadingSpinner size="large" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
      <Header
        user={user}
        onLogout={handleLogout}
        onSettings={() => setShowSettings(true)}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Step Indicator */}
        <div className="mb-8 animate-fade-in-up">
          <StepIndicator steps={STEPS} currentStep={currentStep} />
        </div>

        {/* Debug Info */}
        <div className="mb-6 p-4 glass rounded-xl shadow-lg border border-white/20 text-sm text-gray-700 animate-slide-in-right">
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-semibold text-gray-800 flex items-center">
              <svg className="w-4 h-4 mr-2 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Debug Info:
            </span>
            <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full font-medium">
              Step: {currentStep}
            </span>
            <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full font-medium">
              Accounts: {connectedAccounts.length}
            </span>
            <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full font-medium">
              FAQs: {faqs.length}
            </span>
            {processingStatus && (
              <span className="px-3 py-1 bg-orange-100 text-orange-800 rounded-full font-medium">
                Status: {processingStatus.status}
              </span>
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
                onUpdateFAQs={setFaqs}
              />
            </motion.div>
          )}

          {currentStep === 4 && (
            <motion.div
              key="step4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <AdminFAQManager
                onBack={() => setCurrentStep(3)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Navigation */}
        <div className="mt-12 glass rounded-2xl shadow-xl border border-white/30 p-6 backdrop-blur-xl">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <button
              onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
              disabled={currentStep === 1}
              className="w-full sm:w-auto group relative overflow-hidden bg-white/80 hover:bg-white text-gray-700 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 px-6 py-3 rounded-xl font-medium transition-all duration-200 shadow-lg hover:shadow-xl btn-hover-lift focus-ring"
            >
              <svg className="w-5 h-5 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16l-4-4m0 0l4-4m-4 4h18" />
              </svg>
              <span>Previous Step</span>
            </button>

            <div className="hidden sm:flex items-center space-x-3 px-4 py-2 bg-white/60 rounded-full backdrop-blur-sm">
              <div className="flex space-x-1">
                {STEPS.map((step, index) => (
                  <div
                    key={step.id}
                    className={`w-2 h-2 rounded-full transition-all duration-300 ${
                      index + 1 <= currentStep
                        ? 'bg-blue-500 scale-125'
                        : 'bg-gray-300'
                    }`}
                  />
                ))}
              </div>
              <span className="text-sm font-medium text-gray-700">
                Step {currentStep} of {STEPS.length}
              </span>
            </div>

            <button
              onClick={() => {
                if (currentStep === 4) {
                  // Complete button: Show success message and allow restart
                  toast.success('FAQ management workflow completed successfully!');
                  setCurrentStep(1); // Go back to step 1 to start over
                } else {
                  const nextStep = Math.min(4, currentStep + 1);
                  setCurrentStep(nextStep);
                }
              }}
              disabled={(currentStep === 1 && connectedAccounts.length === 0) || (currentStep === 2 && faqs.length === 0) || (currentStep === 4)}
              className="w-full sm:w-auto group relative overflow-hidden bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 px-6 py-3 rounded-xl font-medium transition-all duration-200 shadow-lg hover:shadow-xl btn-hover-lift focus-ring"
            >
              <span>
                {currentStep === 1 && connectedAccounts.length > 0 ? 'Continue to Processing' :
                 currentStep === 2 && faqs.length > 0 ? 'View Generated FAQs' :
                 currentStep === 3 ? 'Manage FAQs' :
                 currentStep === 4 ? 'Complete' : 'Next Step'}
              </span>
              {currentStep === 4 ? (
                <svg className="w-5 h-5 transition-transform group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              ) : currentStep < 4 && (
                <svg className="w-5 h-5 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        user={user}
      />
    </div>
  );
};

export default AdminDashboard;
