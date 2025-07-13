const logger = require('../utils/logger');
const { initializeQueues } = require('../services/queueService');

async function startWorker() {
  try {
    logger.info('Starting email processor worker...');
    
    // Initialize the queue system
    await initializeQueues();
    
    logger.info('Email processor worker started successfully');
    
    // Keep the process running
    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      process.exit(0);
    });
    
    process.on('SIGINT', () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Failed to start email processor worker:', error);
    process.exit(1);
  }
}

// Start the worker
startWorker();