import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'react-toastify';
import { apiService } from '../services/apiService';

const FAQProcessor = ({ socket, onProcessingComplete }) => {
  const [status, setStatus] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [processingType, setProcessingType] = useState(null); // 'emails' or 'faqs'
  const [progress, setProgress] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingTimeout, setProcessingTimeout] = useState(null);
  const logsEndRef = useRef(null);

  // Load initial status
  useEffect(() => {
    loadStatus();
  }, []);

  // Auto-scroll logs to bottom when new logs are added
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Set up socket listeners for real-time updates
  useEffect(() => {
    if (socket) {
      // Listen for FAQ processing progress
      socket.on('faq_processing_progress', (data) => {
        console.log('FAQ processing progress:', data);
        
        switch (data.type) {
          case 'start':
            addLogThrottled(`🚀 ${data.message}`);
            setProcessingType('emails');
            setProgress({ current: data.processed || 0, total: data.total, percentage: 0 });
            break;
            
          case 'batch_start':
            addLogThrottled(`📦 ${data.message}`);
            break;
            
          case 'email_processed':
            addLogThrottled(`✅ ${data.message}`);
            // Use progress data from backend (more accurate)
            if (data.current !== undefined && data.total !== undefined && data.percentage !== undefined) {
              updateProgress({ 
                current: data.current, 
                total: data.total, 
                percentage: data.percentage 
              });
            }
            // Update local status counts incrementally with throttling
            if (status) {
              updateStatus({
                processed_emails: status.processed_emails + 1,
                pending_emails: Math.max(0, status.pending_emails - 1),
                total_emails: status.total_emails // Keep total the same since we're working with filtered emails
              });
            }
            break;
            
          case 'batch_complete':
            addLogThrottled(`📦 ${data.message} (${data.processed}/${data.total})`);
            // Update progress with data from backend
            if (data.processed !== undefined && data.total !== undefined) {
              const newPercentage = Math.round((data.processed / data.total) * 100);
              updateProgress({ current: data.processed, total: data.total, percentage: newPercentage });
            }
            break;
            
          default:
            addLogThrottled(`ℹ️ ${data.message || 'Processing update received'}`);
        }
      });

      // Listen for FAQ processing completion
      socket.on('faq_processing_complete', (data) => {
        console.log('FAQ processing completed:', data);
        addLogThrottled(`🎉 ${data.message}`);
        setProcessing(false);
        setProcessingType(null);
        setProgress(null);
        
        // Clear timeout
        if (processingTimeout) {
          clearTimeout(processingTimeout);
          setProcessingTimeout(null);
        }
        
        // Only refresh status once at the end, not every second
        loadStatus();
        
        if (onProcessingComplete) {
          onProcessingComplete(data);
        }
      });

      // Listen for FAQ processing errors
      socket.on('faq_processing_error', (data) => {
        console.log('FAQ processing error:', data);
        addLogThrottled(`❌ ${data.message}`);
        setProcessing(false);
        setProcessingType(null);
        setProgress(null);
        
        // Clear timeout
        if (processingTimeout) {
          clearTimeout(processingTimeout);
          setProcessingTimeout(null);
        }
        
        // Only refresh status once on error, not every second
        loadStatus();
      });

      // Listen for FAQ generation progress
      socket.on('faq_generation_progress', (data) => {
        console.log('FAQ generation progress:', data);
        
        switch (data.step) {
          case 'starting':
            addLogThrottled(`🚀 ${data.message}`);
            setProcessingType('faqs');
            setProgress({ current: 0, total: 100, percentage: data.progress });
            break;
            
          case 'auto_fix':
            addLogThrottled(`🔧 ${data.message}`);
            setProgress(prev => prev ? { ...prev, percentage: data.progress } : { current: 0, total: 100, percentage: data.progress });
            break;
            
          case 'auto_fix_warning':
            addLogThrottled(`⚠️ ${data.message}`);
            setProgress(prev => prev ? { ...prev, percentage: data.progress } : { current: 0, total: 100, percentage: data.progress });
            break;
            
          case 'loading_questions':
            addLogThrottled(`📚 ${data.message}`);
            setProgress(prev => prev ? { ...prev, percentage: data.progress } : { current: 0, total: 100, percentage: data.progress });
            break;
            
          case 'no_questions':
            addLogThrottled(`❓ ${data.message}`);
            setProgress(prev => prev ? { ...prev, percentage: data.progress } : { current: 0, total: 100, percentage: data.progress });
            break;
            
          case 'clustering':
            addLogThrottled(`🔍 ${data.message}`);
            setProgress(prev => prev ? { ...prev, percentage: data.progress } : { current: 0, total: 100, percentage: data.progress });
            break;
            
          case 'generating_faqs':
            addLogThrottled(`📝 ${data.message}`);
            setProgress(prev => prev ? { ...prev, percentage: data.progress } : { current: 0, total: 100, percentage: data.progress });
            break;
            
          case 'processing_cluster':
            addLogThrottled(`⚙️ ${data.message} (${data.current}/${data.total})`);
            setProgress(prev => prev ? { ...prev, percentage: data.progress } : { current: 0, total: 100, percentage: data.progress });
            break;
            
          case 'creating_faqs':
            addLogThrottled(`📝 ${data.message}`);
            setProgress(prev => prev ? { ...prev, percentage: data.progress } : { current: 0, total: 100, percentage: data.progress });
            break;
            
          case 'publishing':
            addLogThrottled(`📤 ${data.message}`);
            setProgress(prev => prev ? { ...prev, percentage: data.progress } : { current: 0, total: 100, percentage: data.progress });
            break;
            
          default:
            addLogThrottled(`ℹ️ ${data.message || 'FAQ generation update received'}`);
            if (data.progress !== undefined) {
              setProgress(prev => prev ? { ...prev, percentage: data.progress } : { current: 0, total: 100, percentage: data.progress });
            }
        }
      });

      // Listen for FAQ generation completion
      socket.on('faq_generation_complete', (data) => {
        console.log('FAQ generation completed:', data);
        addLogThrottled(`🎉 FAQ generation completed! Generated: ${data.generated}, Updated: ${data.updated}, Processed: ${data.processed}, Clusters: ${data.clusters}`);
        setProcessing(false);
        setProcessingType(null);
        setProgress(null);
        
        // Clear timeout
        if (processingTimeout) {
          clearTimeout(processingTimeout);
          setProcessingTimeout(null);
        }
        
        // Refresh status to show updated FAQ counts
        loadStatus();
        
        if (onProcessingComplete) {
          onProcessingComplete(data);
        }
      });

      // Listen for FAQ generation errors
      socket.on('faq_generation_error', (data) => {
        console.log('FAQ generation error:', data);
        addLogThrottled(`❌ FAQ generation failed: ${data.error}`);
        setProcessing(false);
        setProcessingType(null);
        setProgress(null);
        
        // Clear timeout
        if (processingTimeout) {
          clearTimeout(processingTimeout);
          setProcessingTimeout(null);
        }
        
        // Refresh status to show error state
        loadStatus();
      });

      // Cleanup socket listeners
      return () => {
        socket.off('faq_processing_progress');
        socket.off('faq_processing_complete');
        socket.off('faq_processing_error');
        socket.off('faq_generation_progress');
        socket.off('faq_generation_complete');
        socket.off('faq_generation_error');
        
        // Clear timeout on unmount
        if (processingTimeout) {
          clearTimeout(processingTimeout);
        }
      };
    }
  }, [socket, progress, onProcessingComplete, processingTimeout]);

  // Load processing status
  const loadStatus = async () => {
    try {
      setLoading(true);
      const response = await apiService.getProcessingStatus();
      
      if (response.success && response.overall_stats) {
        setStatus({
          total_emails: response.overall_stats.filtered_total_emails || 0, // Use filtered total instead of total_emails
          processed_emails: response.overall_stats.filtered_processed_emails || 0, // Use filtered processed instead of processed_emails
          pending_emails: response.overall_stats.filtered_pending_emails || 0, // Use filtered pending instead of pending_emails
          total_questions: response.overall_stats.customer_questions || 0,
          processing_progress: response.overall_stats.filtered_processed_emails > 0
            ? Math.round((response.overall_stats.filtered_processed_emails / response.overall_stats.filtered_total_emails) * 100)
            : 0
        });
      } else {
        // Fallback to old structure if new fields don't exist
        setStatus({
          total_emails: response.overall_stats?.total_emails || 0,
          processed_emails: response.overall_stats?.processed_emails || 0,
          pending_emails: response.overall_stats?.pending_emails || 0,
          total_questions: response.overall_stats?.customer_questions || 0,
          processing_progress: response.overall_stats?.processed_emails > 0
            ? Math.round((response.overall_stats.processed_emails / response.overall_stats.total_emails) * 100)
            : 0
        });
      }
    } catch (error) {
      console.error('Failed to load processing status:', error);
      toast.error('Failed to load processing status');
      
      // Set default status on error
      setStatus({
        total_emails: 0,
        processed_emails: 0,
        pending_emails: 0,
        total_questions: 0,
        processing_progress: 0
      });
    } finally {
      setLoading(false);
    }
  };

  // Ref to track last update times for throttling
  const lastUpdateRef = useRef({
    progress: 0,
    status: 0,
    logs: 0
  });

  // Throttled progress update to prevent excessive re-renders
  const updateProgress = useCallback((newProgress) => {
    const now = Date.now();
    // Only update progress every 100ms to prevent excessive re-renders
    if (now - lastUpdateRef.current.progress < 100) {
      return;
    }
    lastUpdateRef.current.progress = now;
    
    setProgress(prev => {
      // Only update if there's a meaningful change (more than 1% or 1 email)
      if (!prev || 
          Math.abs(newProgress.percentage - prev.percentage) > 1 || 
          Math.abs(newProgress.current - prev.current) > 1) {
        return newProgress;
      }
      return prev;
    });
  }, []);

  // Throttled status update to prevent excessive re-renders
  const updateStatus = useCallback((updates) => {
    const now = Date.now();
    // Only update status every 200ms to prevent excessive re-renders
    if (now - lastUpdateRef.current.status < 200) {
      return;
    }
    lastUpdateRef.current.status = now;
    
    setStatus(prev => {
      if (!prev) return prev;
      // Only update if there are meaningful changes
      const hasChanges = Object.keys(updates).some(key => 
        prev[key] !== updates[key]
      );
      return hasChanges ? { ...prev, ...updates } : prev;
    });
  }, []);

  // Throttled log update to prevent excessive re-renders
  const addLogThrottled = useCallback((message) => {
    const now = Date.now();
    // Only update logs every 150ms to prevent excessive re-renders
    if (now - lastUpdateRef.current.logs < 150) {
      return;
    }
    lastUpdateRef.current.logs = now;
    
    const timestamp = new Date().toLocaleTimeString();
    const newLog = `[${timestamp}] ${message}`;
    
    setLogs(prev => {
      // Only update if the new log is different from the last one
      if (prev.length > 0 && prev[prev.length - 1] === newLog) {
        return prev;
      }
      const newLogs = [...prev.slice(-49), newLog]; // Keep last 49 + 1 new = 50
      return newLogs;
    });
  }, []);

  const handleProgressUpdate = (data) => {
    setProgress(data);
    addLogThrottled(`Processing email ${data.current}/${data.total}: ${data.currentEmail || 'Unknown'}`);
    addLogThrottled(`Found ${data.questions} questions so far (${data.errors} errors)`);
  };

  const handleProcessingComplete = (data) => {
    setProcessing(false);
    setProgress(null);
    addLogThrottled(`✅ Processing complete!`);
    addLogThrottled(`📊 Results: ${data.processed} emails processed, ${data.questionsFound} questions found`);
    addLogThrottled(`📚 Created ${data.faqGroupsCreated} FAQ groups from ${data.questionsGrouped} questions`);

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
    addLogThrottled(`❌ Processing failed: ${data.error}`);
    toast.error(`FAQ processing failed: ${data.error}`);
  };

  const handleFAQGenerationProgress = (data) => {
    setProgress({
      step: data.step,
      message: data.message,
      progress: data.progress,
      current: data.current || 0,
      total: data.total || 100
    });
    addLogThrottled(`🔄 ${data.message} (${data.progress}%)`);
  };

  const handleFAQGenerationComplete = (data) => {
    setProcessing(false);
    setProgress(null);
    addLogThrottled(`✅ FAQ generation complete!`);
    addLogThrottled(`📚 Results: ${data.generated} FAQs generated, ${data.updated} FAQs updated`);
    addLogThrottled(`📊 Processed ${data.processed} questions in ${data.clusters} clusters`);

    toast.success(`FAQ generation complete! Generated ${data.generated} FAQs and updated ${data.updated} existing ones.`);

    // Reload status
    loadStatus();

    // Notify parent component
    if (onProcessingComplete) {
      onProcessingComplete(data);
    }
  };

  const handleFAQGenerationError = (data) => {
    setProcessing(false);
    setProgress(null);
    addLogThrottled(`❌ FAQ generation failed: ${data.error}`);
    toast.error(`FAQ generation failed: ${data.error}`);
  };

  const addLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    const newLog = `[${timestamp}] ${message}`;
    
    setLogs(prev => {
      // Only update if the new log is different from the last one
      if (prev.length > 0 && prev[prev.length - 1] === newLog) {
        return prev;
      }
      const newLogs = [...prev.slice(-49), newLog]; // Keep last 49 + 1 new = 50
      return newLogs;
    });
  };

  const startProcessing = async (limit = 100) => {
    try {
      setProcessing(true);
      setProcessingType('emails');
      setProgress({ current: 0, total: limit, percentage: 0 });
      setLogs([]);
      addLogThrottled(`🚀 Starting FAQ processing for up to ${limit} emails...`);

      // Set timeout to reset processing state if no updates received
      const timeout = setTimeout(() => {
        if (processing) {
          addLogThrottled(`⏰ Processing timeout - no updates received. Please check status manually.`);
          setProcessing(false);
          setProgress(null);
          toast.warning('Processing timeout - please check status manually');
        }
      }, 30000); // 30 second timeout
      setProcessingTimeout(timeout);

      const data = await apiService.processFAQs(limit);

      if (data.success) {
        addLogThrottled(`✅ Processing started for ${data.emailCount} emails`);
        toast.success(`Started processing ${data.emailCount} emails`);
        
        // Update progress with actual email count
        setProgress({ current: 0, total: data.emailCount, percentage: 0 });
      } else {
        throw new Error(data.error || 'Failed to start processing');
      }
    } catch (error) {
      setProcessing(false);
      setProcessingType(null);
      setProgress(null);
      if (processingTimeout) {
        clearTimeout(processingTimeout);
        setProcessingTimeout(null);
      }
      addLogThrottled(`❌ Failed to start processing: ${error.message}`);
      toast.error(`Failed to start processing: ${error.message}`);
    }
  };

  const generateFAQs = async () => {
    try {
      setProcessing(true);
      setProcessingType('faqs');
      setProgress({ current: 0, total: 100, percentage: 0 });
      addLogThrottled(`🧠 Starting FAQ generation with auto-fix...`);

      // Set timeout for FAQ generation
      const timeout = setTimeout(() => {
        addLogThrottled(`⏰ FAQ generation timeout - no updates received. Please check status manually.`);
        setProcessing(false);
        setProgress(null);
        toast.warning('FAQ generation timeout - please check status manually');
      }, 60000); // 60 second timeout for FAQ generation (longer than email processing)
      setProcessingTimeout(timeout);

      const data = await apiService.generateFAQs({
        minQuestionCount: 1,
        maxFAQs: 100, // Increased from 20 to allow more FAQs to be generated
        forceRegenerate: false,
        autoFix: true
      });

      if (data.success) {
        addLogThrottled(`✅ FAQ generation started with auto-fix enabled`);
        toast.success('FAQ generation started! This will automatically fix any data issues.');
      } else {
        throw new Error(data.error || 'Failed to start FAQ generation');
      }
    } catch (error) {
      setProcessing(false);
      setProcessingType(null);
      setProgress(null);
      if (processingTimeout) {
        clearTimeout(processingTimeout);
        setProcessingTimeout(null);
      }
      addLogThrottled(`❌ Failed to start FAQ generation: ${error.message}`);
      toast.error(`Failed to start FAQ generation: ${error.message}`);
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  if (loading) {
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

        {/* Progress Bar - Only show for email processing */}
        {processing && processingType === 'emails' && (
          <div className="mb-6">
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span>Email Processing Progress</span>
              <span>
                {progress ? (
                  `${progress.current || 0} / ${progress.total || 0} (${progress.percentage || 0}%)`
                ) : (
                  'Initializing...'
                )}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress?.percentage || 0}%` }}
              ></div>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {progress ? (
                `Processing emails in real-time... ${progress.current || 0} of ${progress.total || 0} completed`
              ) : (
                'Connecting to processing service...'
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => startProcessing(50)}
            disabled={processing || !status || status.pending_emails === 0}
            className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {processing ? 'Processing...' : 'Process 50 Emails'}
          </button>

          <button
            onClick={() => startProcessing(100)}
            disabled={processing || !status || status.pending_emails === 0 || status.pending_emails < 100}
            className="bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {processing ? 'Processing...' : 'Process 100 Emails'}
          </button>

          <button
            onClick={() => startProcessing(status?.pending_emails || 0)}
            disabled={processing || !status || status.pending_emails === 0}
            className="bg-purple-500 hover:bg-purple-600 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {processing ? 'Processing...' : `Process All ${status?.pending_emails || 0} Emails`}
          </button>

          <button
            onClick={generateFAQs}
            disabled={processing}
            className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {processing ? 'Generating...' : '🧠 Generate FAQs'}
          </button>

          <button
            onClick={loadStatus}
            disabled={processing}
            className="bg-gray-500 hover:bg-gray-600 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            🔄 Refresh Status
          </button>
        </div>

        {/* Status Information */}
        {status && (
          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-medium text-gray-900 mb-2">Current Status</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-600">Total Emails:</span>
                <span className="ml-2 font-medium">{status.total_emails}</span>
              </div>
              <div>
                <span className="text-gray-600">Processed:</span>
                <span className="ml-2 font-medium">{status.processed_emails}</span>
              </div>
              <div>
                <span className="text-gray-600">Pending:</span>
                <span className="ml-2 font-medium">{status.pending_emails}</span>
              </div>
              <div>
                <span className="text-gray-600">Questions:</span>
                <span className="ml-2 font-medium">{status.total_questions}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Real-time Progress */}
      {progress && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-blue-50 border border-blue-200 rounded-lg p-4"
        >
          <h3 className="font-semibold text-blue-900 mb-2">
            {progress.step === 'starting' && '🚀 Starting FAQ Generation'}
            {progress.step === 'auto_fix' && '🔧 Auto-Fix in Progress'}
            {progress.step === 'auto_fix_confidence' && '🧠 Fixing Confidence Scores'}
            {progress.step === 'fixing_confidence' && '🧠 AI Re-evaluation'}
            {progress.step === 'auto_fix_embeddings' && '🔗 Generating Embeddings'}
            {progress.step === 'fixing_embeddings' && '🔗 Creating Vector Embeddings'}
            {progress.step === 'loading_questions' && '📋 Loading Questions'}
            {progress.step === 'clustering' && '🔍 Clustering Similar Questions'}
            {progress.step === 'generating_faqs' && '📚 Creating FAQ Groups'}
            {progress.step === 'processing_cluster' && '⚙️ Processing Question Clusters'}
            {!progress.step && 'Processing in Progress'}
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{progress.message}</span>
              <span className="font-semibold">{progress.progress}%</span>
            </div>
            <div className="w-full bg-blue-200 rounded-full h-3">
              <div
                className="bg-blue-500 h-3 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progress.progress}%` }}
              ></div>
            </div>
            {progress.current && progress.total && (
              <div className="text-xs text-blue-700">
                Progress: {progress.current}/{progress.total} items
              </div>
            )}
            {progress.questions && (
              <div className="text-xs text-blue-700">
                Questions found: {progress.questions} | Errors: {progress.errors}
              </div>
            )}
            {progress.currentEmail && (
              <div className="text-xs text-blue-600 truncate">
                Current: {progress.currentEmail}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Processing Logs */}
      <div className="bg-gray-900 text-green-400 rounded-lg p-4">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-semibold text-green-400">Processing Logs</h3>
          <button
            onClick={clearLogs}
            className="text-gray-400 hover:text-white text-sm px-2 py-1 rounded border border-gray-600 hover:border-gray-400 transition-colors"
          >
            Clear
          </button>
        </div>
        <div className="h-48 overflow-y-auto font-mono text-sm space-y-1">
          {processing && logs.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-400"></div>
              <span className="ml-2 text-green-400">Initializing processing...</span>
            </div>
          ) : logs.length === 0 ? (
            <div className="text-gray-500 italic">No processing logs yet. Start processing emails to see live updates.</div>
          ) : (
            <>
              {logs.map((log, index) => (
                <div key={index} className="text-green-300">
                  {log}
                </div>
              ))}
              <div ref={logsEndRef} />
            </>
          )}
        </div>
      </div>

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
