import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'react-toastify';
import { apiService } from '../services/apiService';

const FAQProcessor = ({ socket, onProcessingComplete }) => {
  const [status, setStatus] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(null);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    // Load initial status
    loadStatus();

    // Set up socket listeners for real-time updates
    if (socket) {
      socket.on('faq_processing_progress', handleProgressUpdate);
      socket.on('faq_processing_complete', handleProcessingComplete);
      socket.on('faq_processing_error', handleProcessingError);
    }

    return () => {
      if (socket) {
        socket.off('faq_processing_progress', handleProgressUpdate);
        socket.off('faq_processing_complete', handleProcessingComplete);
        socket.off('faq_processing_error', handleProcessingError);
      }
    };
  }, [socket]);

  const loadStatus = async () => {
    try {
      const response = await fetch('/api/sync/faq-status');
      const data = await response.json();
      if (data.success) {
        setStatus(data.status);
      }
    } catch (error) {
      console.error('Failed to load FAQ status:', error);
    }
  };

  const handleProgressUpdate = (data) => {
    setProgress(data);
    addLog(`Processing email ${data.current}/${data.total}: ${data.currentEmail || 'Unknown'}`);
    addLog(`Found ${data.questions} questions so far (${data.errors} errors)`);
  };

  const handleProcessingComplete = (data) => {
    setProcessing(false);
    setProgress(null);
    addLog(`✅ Processing complete!`);
    addLog(`📊 Results: ${data.processed} emails processed, ${data.questionsFound} questions found`);
    addLog(`📚 Created ${data.faqGroupsCreated} FAQ groups from ${data.questionsGrouped} questions`);
    
    toast.success(`FAQ processing complete! Found ${data.questionsFound} questions and created ${data.faqGroupsCreated} FAQ groups.`);
    
    // Reload status
    loadStatus();
    
    // Notify parent component
    if (onProcessingComplete) {
      onProcessingComplete(data);
    }
  };

  const handleProcessingError = (data) => {
    setProcessing(false);
    setProgress(null);
    addLog(`❌ Processing failed: ${data.error}`);
    toast.error(`FAQ processing failed: ${data.error}`);
  };

  const addLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-50), `[${timestamp}] ${message}`]); // Keep last 50 logs
  };

  const startProcessing = async (limit = 100) => {
    try {
      setProcessing(true);
      setProgress(null);
      setLogs([]);
      addLog(`🚀 Starting FAQ processing for up to ${limit} emails...`);

      const response = await fetch('/api/sync/process-faqs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ limit }),
      });

      const data = await response.json();
      
      if (data.success) {
        addLog(`✅ Processing started for ${data.emailCount} emails`);
        toast.success(`Started processing ${data.emailCount} emails`);
      } else {
        throw new Error(data.error || 'Failed to start processing');
      }
    } catch (error) {
      setProcessing(false);
      addLog(`❌ Failed to start processing: ${error.message}`);
      toast.error(`Failed to start processing: ${error.message}`);
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  if (!status) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span className="ml-2">Loading FAQ processing status...</span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Status Overview */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">FAQ Processing Center</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="text-2xl font-bold text-blue-600">{status.total_emails}</div>
            <div className="text-sm text-gray-600">Total Emails</div>
          </div>
          
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="text-2xl font-bold text-green-600">{status.processed_emails}</div>
            <div className="text-sm text-gray-600">Processed</div>
          </div>
          
          <div className="bg-yellow-50 p-4 rounded-lg">
            <div className="text-2xl font-bold text-yellow-600">{status.pending_emails}</div>
            <div className="text-sm text-gray-600">Pending</div>
          </div>
          
          <div className="bg-purple-50 p-4 rounded-lg">
            <div className="text-2xl font-bold text-purple-600">{status.total_questions}</div>
            <div className="text-sm text-gray-600">Questions Found</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-6">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>Processing Progress</span>
            <span>{status.processing_progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${status.processing_progress}%` }}
            ></div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => startProcessing(50)}
            disabled={processing}
            className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {processing ? 'Processing...' : 'Process 50 Emails'}
          </button>
          
          <button
            onClick={() => startProcessing(100)}
            disabled={processing}
            className="bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {processing ? 'Processing...' : 'Process 100 Emails'}
          </button>
          
          <button
            onClick={() => startProcessing(status.pending_emails)}
            disabled={processing || status.pending_emails === 0}
            className="bg-purple-500 hover:bg-purple-600 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {processing ? 'Processing...' : `Process All ${status.pending_emails} Emails`}
          </button>
          
          <button
            onClick={loadStatus}
            disabled={processing}
            className="bg-gray-500 hover:bg-gray-600 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            Refresh Status
          </button>
        </div>
      </div>

      {/* Real-time Progress */}
      {progress && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-blue-50 border border-blue-200 rounded-lg p-4"
        >
          <h3 className="font-semibold text-blue-900 mb-2">Processing in Progress</h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Email {progress.current} of {progress.total}</span>
              <span>{Math.round((progress.current / progress.total) * 100)}%</span>
            </div>
            <div className="w-full bg-blue-200 rounded-full h-2">
              <div 
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              ></div>
            </div>
            <div className="text-xs text-blue-700">
              Questions found: {progress.questions} | Errors: {progress.errors}
            </div>
            {progress.currentEmail && (
              <div className="text-xs text-blue-600 truncate">
                Current: {progress.currentEmail}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Processing Logs */}
      {logs.length > 0 && (
        <div className="bg-gray-900 text-green-400 rounded-lg p-4 font-mono text-sm">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-semibold">Processing Logs</h3>
            <button
              onClick={clearLogs}
              className="text-gray-400 hover:text-white text-xs"
            >
              Clear
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {logs.map((log, index) => (
              <div key={index} className="text-xs">
                {log}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Help Text */}
      <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
        <h4 className="font-semibold mb-2">How it works:</h4>
        <ul className="space-y-1 list-disc list-inside">
          <li>Click a processing button to start analyzing your emails with AI</li>
          <li>The system will extract customer questions and answers from email conversations</li>
          <li>Similar questions will be grouped together to create comprehensive FAQs</li>
          <li>Processing happens in the background with real-time progress updates</li>
          <li>Start with 50 emails to test, then process larger batches</li>
        </ul>
      </div>
    </motion.div>
  );
};

export default FAQProcessor;