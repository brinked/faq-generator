const express = require('express');
const router = express.Router();
const db = require('../config/database');
const logger = require('../utils/logger');

/**
 * Test database connection and tables
 */
router.get('/test', async (req, res) => {
  try {
    logger.info('Testing database connection...');
    
    // Test basic connection
    const testQuery = await db.query('SELECT NOW() as current_time');
    logger.info('Database connection successful:', testQuery.rows[0]);
    
    // Check if tables exist
    const tablesQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;
    
    const tables = await db.query(tablesQuery);
    logger.info('Database tables:', tables.rows.map(r => r.table_name));
    
    // Check processing_jobs table
    const hasProcessingJobs = tables.rows.some(r => r.table_name === 'processing_jobs');
    
    // Check email accounts
    const accountsQuery = `
      SELECT id, email_address, status, last_sync_at
      FROM email_accounts
      ORDER BY created_at DESC
      LIMIT 5;
    `;
    
    let accounts = [];
    try {
      const accountsResult = await db.query(accountsQuery);
      accounts = accountsResult.rows;
    } catch (error) {
      logger.error('Error querying email_accounts:', error);
    }
    
    res.json({
      success: true,
      database: {
        connected: true,
        currentTime: testQuery.rows[0].current_time,
        tables: tables.rows.map(r => r.table_name),
        hasProcessingJobs,
        accounts
      }
    });
    
  } catch (error) {
    logger.error('Database test error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.stack
    });
  }
});

/**
 * Create missing tables
 */
router.post('/create-tables', async (req, res) => {
  try {
    logger.info('Creating missing tables...');
    
    // Create processing_jobs table if it doesn't exist
    const createProcessingJobsQuery = `
      CREATE TABLE IF NOT EXISTS processing_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID REFERENCES email_accounts(id) ON DELETE CASCADE,
        job_type VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        error_message TEXT,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_processing_jobs_account_id ON processing_jobs(account_id);
      CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_processing_jobs_job_type ON processing_jobs(job_type);
    `;
    
    await db.query(createProcessingJobsQuery);
    logger.info('processing_jobs table created/verified');
    
    res.json({
      success: true,
      message: 'Tables created successfully'
    });
    
  } catch (error) {
    logger.error('Error creating tables:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;