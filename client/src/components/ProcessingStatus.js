import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import LoadingSpinner, { LoadingDots } from './LoadingSpinner';
import EmailFilteringStats from './EmailFilteringStats';

const ProcessingStatus = ({ status, connectedAccounts, onSyncEmails, onContinue, canContinue }) => {
  const [localStatus, setLocalStatus] = useState(status);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    setLocalStatus(status);
  }, [status]);

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

  return (
    <div className="max-w-4xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center mb-8"
      >
        <h2 className="text-3xl font-bold text-gray-900 mb-4">
          Email Processing
        </h2>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Our AI is analyzing your emails to identify frequently asked questions and generate helpful FAQs.
        </p>
      </motion.div>

      {/* Connected Accounts Summary */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="card mb-8"
      >
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Connected Accounts</h3>
        <div className="grid gap-4 md:grid-cols-2">
          {connectedAccounts.map((account) => (
            <div key={account.id} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center justify-center w-8 h-8 bg-primary-100 rounded-full">
                <svg className="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900">{account.email}</p>
                <p className="text-sm text-gray-500 capitalize">{account.provider}</p>
              </div>
              <div className="flex items-center space-x-1 text-sm text-success-600">
                <div className="w-2 h-2 bg-success-500 rounded-full"></div>
                <span>Active</span>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Processing Status */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="card mb-8"
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Processing Status</h3>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-sm text-primary-600 hover:text-primary-700 transition-colors duration-200"
          >
            {showDetails ? 'Hide Details' : 'Show Details'}
          </button>
        </div>

        {/* Status Message */}
        <div className="flex items-center space-x-3 mb-6">
          <div className={getStatusColor(localStatus?.status)}>
            {getStatusIcon(localStatus?.status)}
          </div>
          <div className="flex-1">
            <p className={`font-medium ${getStatusColor(localStatus?.status)}`}>
              {formatStatusMessage(localStatus)}
            </p>
            {localStatus?.timestamp && (
              <p className="text-sm text-gray-500 mt-1">
                Last updated: {new Date(localStatus.timestamp).toLocaleString()}
              </p>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        {localStatus?.status === 'processing' && (
          <div className="mb-6">
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span>Progress</span>
              <span>{getProgressPercentage()}%</span>
            </div>
            <div className="progress-bar">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${getProgressPercentage()}%` }}
                transition={{ duration: 0.5 }}
                className="progress-fill"
              />
            </div>
            {localStatus.progress?.currentStep && (
              <p className="text-sm text-gray-600 mt-2">
                Current step: {localStatus.progress.currentStep}
              </p>
            )}
          </div>
        )}

        {/* Processing Steps */}
        {localStatus?.status === 'processing' && (
          <div className="space-y-3">
            {[
              { step: 'Fetching emails', completed: getProgressPercentage() > 20 },
              { step: 'Analyzing content', completed: getProgressPercentage() > 40 },
              { step: 'Detecting questions', completed: getProgressPercentage() > 60 },
              { step: 'Grouping similar questions', completed: getProgressPercentage() > 80 },
              { step: 'Generating FAQs', completed: getProgressPercentage() > 95 }
            ].map((item, index) => (
              <div key={index} className="flex items-center space-x-3">
                <div className={`
                  w-4 h-4 rounded-full border-2 flex items-center justify-center
                  ${item.completed 
                    ? 'bg-success-600 border-success-600' 
                    : getProgressPercentage() > (index * 20)
                      ? 'border-primary-600 bg-primary-100'
                      : 'border-gray-300 bg-gray-100'
                  }
                `}>
                  {item.completed && (
                    <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                <span className={`text-sm ${
                  item.completed ? 'text-success-600' : 
                  getProgressPercentage() > (index * 20) ? 'text-primary-600' : 'text-gray-500'
                }`}>
                  {item.step}
                </span>
                {getProgressPercentage() > (index * 20) && !item.completed && (
                  <LoadingDots text="" className="ml-2" />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Detailed Status */}
        <AnimatePresence>
          {showDetails && localStatus && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-6 p-4 bg-gray-50 rounded-lg"
            >
              <h4 className="font-medium text-gray-900 mb-2">Processing Details</h4>
              <div className="space-y-2 text-sm">
                {localStatus.emailsProcessed && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Emails processed:</span>
                    <span className="font-medium">{localStatus.emailsProcessed}</span>
                  </div>
                )}
                {localStatus.questionsFound && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Questions found:</span>
                    <span className="font-medium">{localStatus.questionsFound}</span>
                  </div>
                )}
                {localStatus.faqsGenerated && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">FAQs generated:</span>
                    <span className="font-medium">{localStatus.faqsGenerated}</span>
                  </div>
                )}
                {localStatus.processingTime && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Processing time:</span>
                    <span className="font-medium">{localStatus.processingTime}</span>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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
          disabled={localStatus?.status === 'processing'}
          className="btn-secondary flex items-center justify-center space-x-2 flex-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>Sync Emails</span>
        </button>

        <button
          onClick={onContinue}
          disabled={!canContinue}
          className="btn-primary flex items-center justify-center space-x-2 flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span>View FAQs</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </motion.div>

      {/* Processing Animation */}
      {localStatus?.status === 'processing' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed bottom-8 right-8 bg-white rounded-lg shadow-lg p-4 border border-gray-200"
        >
          <div className="flex items-center space-x-3">
            <LoadingSpinner size="small" />
            <div>
              <p className="text-sm font-medium text-gray-900">Processing emails...</p>
              <p className="text-xs text-gray-500">This may take a few minutes</p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default ProcessingStatus;