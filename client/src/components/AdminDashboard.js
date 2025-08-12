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
        await loadProcessingStatus();

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

  // Poll for processing status updates when there are active jobs
  useEffect(() => {
    if (!isAuthenticated) return;

    let statusPollingInterval;
    
    const startStatusPolling = () => {
      statusPollingInterval = setInterval(async () => {
        try {
          await loadProcessingStatus();
        } catch (error) {
          console.error('Failed to poll processing status:', error);
        }
      }, 2000); // Poll every 2 seconds when there are active jobs
    };

    const stopStatusPolling = () => {
      if (statusPollingInterval) {
        clearInterval(statusPollingInterval);
        statusPollingInterval = null;
      }
    };

    // Check if there are any active processing jobs
    if (processingStatus?.accounts) {
      const hasActiveJobs = processingStatus.accounts.some(acc => 
        acc.current_job && acc.current_job.status === 'processing'
      );
      
      if (hasActiveJobs && !statusPollingInterval) {
        startStatusPolling();
      } else if (!hasActiveJobs && statusPollingInterval) {
        stopStatusPolling();
      }
    }

    return () => {
      stopStatusPolling();
    };
  }, [isAuthenticated, processingStatus?.accounts]); // Only depend on accounts array, not the entire status object

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

  // Load processing status
  const loadProcessingStatus = async () => {
    try {
      const status = await apiService.getProcessingStatus();
      setProcessingStatus(status);
    } catch (error) {
      console.error('Failed to load processing status:', error);
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
      toast.info('Starting email sync for all accounts...');
      const result = await apiService.syncAllEmails();
      
      // Immediately refresh processing status to show the new job
      await loadProcessingStatus();
      
      toast.success(`Email sync started! ${result.message || 'Processing in background'}`);
      
      // Start polling for updates
      if (result.success) {
        // The polling effect will automatically start when it detects active jobs
        console.log('Email sync initiated, monitoring progress...');
      }
    } catch (error) {
      console.error('Failed to sync emails:', error);
      toast.error(`Failed to start email sync: ${error.message}`);
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

        {/* Quick Stats Dashboard */}
        <div className="mb-8 grid grid-cols-1 md:grid-cols-4 gap-4 animate-fade-in-up">
          <div className="glass rounded-xl p-4 shadow-lg border border-white/20">
            <div className="flex items-center">
              <div className="p-2 bg-blue-100 rounded-lg">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-600">Connected Accounts</p>
                <p className="text-2xl font-bold text-gray-900">{connectedAccounts.length}</p>
              </div>
            </div>
          </div>
          
          <div className="glass rounded-xl p-4 shadow-lg border border-white/20">
            <div className="flex items-center">
              <div className="p-2 bg-green-100 rounded-lg">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-600">Generated FAQs</p>
                <p className="text-2xl font-bold text-gray-900">{faqs.length}</p>
              </div>
            </div>
          </div>
          
          <div className="glass rounded-xl p-4 shadow-lg border border-white/20">
            <div className="flex items-center">
              <div className="p-2 bg-purple-100 rounded-lg">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-600">Current Step</p>
                <p className="text-2xl font-bold text-gray-900">{currentStep}/4</p>
              </div>
            </div>
          </div>
          
          <div className="glass rounded-xl p-4 shadow-lg border border-white/20">
            <div className="flex items-center">
              <div className={`p-2 rounded-lg ${processingStatus?.overall_stats?.active_jobs > 0 ? 'bg-orange-100' : 'bg-gray-100'}`}>
                <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-600">Active Jobs</p>
                <p className="text-2xl font-bold text-gray-900">{processingStatus?.overall_stats?.active_jobs || 0}</p>
              </div>
            </div>
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
                <div className="space-y-8">
                  {/* Unified Processing Dashboard */}
                  <div className="glass rounded-2xl shadow-xl border border-white/30 p-6 backdrop-blur-xl">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-2xl font-bold text-gray-900">Email Processing & FAQ Generation</h2>
                      <button
                        onClick={handleSyncEmails}
                        className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center space-x-2"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <span>Sync All Emails</span>
                      </button>
                    </div>
                    
                    <FAQProcessor
                      socket={socket}
                      onProcessingComplete={(result) => {
                        loadFAQs();
                        toast.success(`Processing complete! Found ${result.questionsFound} questions and created ${result.faqGroupsCreated} FAQ groups.`);
                      }}
                    />
                  </div>
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
