#!/usr/bin/env node

/**
 * Production Database Initialization Script
 * 
 * This script initializes the production database with the required schema.
 * It should be run once when deploying to a new environment.
 * 
 * Usage: node scripts/init-production-db.js
 */

require('dotenv').config();
const { runMigration } = require('./migrate');
const logger = require('../src/utils/logger');

async function initProductionDatabase() {
  try {
    logger.info('='.repeat(50));
    logger.info('PRODUCTION DATABASE INITIALIZATION');
    logger.info('='.repeat(50));
    
    // Check if we're in production
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('Warning: NODE_ENV is not set to "production"');
      logger.warn('Current NODE_ENV:', process.env.NODE_ENV || 'undefined');
    }
    
    // Check if DATABASE_URL is set
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    
    logger.info('Database URL configured:', process.env.DATABASE_URL.replace(/:[^:@]*@/, ':***@'));
    
    // Run the migration
    await runMigration();
    
    logger.info('='.repeat(50));
    logger.info('DATABASE INITIALIZATION COMPLETED SUCCESSFULLY');
    logger.info('='.repeat(50));
    
    process.exit(0);
    
  } catch (error) {
    logger.error('='.repeat(50));
    logger.error('DATABASE INITIALIZATION FAILED');
    logger.error('='.repeat(50));
    logger.error('Error:', error.message);
    logger.error('Stack:', error.stack);
    
    process.exit(1);
  }
}

// Run the initialization
initProductionDatabase();