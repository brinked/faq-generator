const db = require('../src/config/database');
const logger = require('../src/utils/logger');

async function checkDatabaseTables() {
  try {
    logger.info('Checking database tables...');
    
    // Check if tables exist
    const tableCheckQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;
    
    const tablesResult = await db.query(tableCheckQuery);
    logger.info('Existing tables:', tablesResult.rows.map(r => r.table_name));
    
    // Check processing_jobs table structure if it exists
    const hasProcessingJobs = tablesResult.rows.some(r => r.table_name === 'processing_jobs');
    
    if (!hasProcessingJobs) {
      logger.warn('processing_jobs table does not exist!');
      
      // Create the table
      const createTableQuery = `
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
      
      logger.info('Creating processing_jobs table...');
      await db.query(createTableQuery);
      logger.info('processing_jobs table created successfully');
    } else {
      // Check table structure
      const columnsQuery = `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'processing_jobs'
        ORDER BY ordinal_position;
      `;
      
      const columnsResult = await db.query(columnsQuery);
      logger.info('processing_jobs columns:', columnsResult.rows);
    }
    
    // Check if there are any sync jobs
    if (hasProcessingJobs) {
      const jobsQuery = `
        SELECT job_type, status, COUNT(*) as count
        FROM processing_jobs
        GROUP BY job_type, status
        ORDER BY job_type, status;
      `;
      
      const jobsResult = await db.query(jobsQuery);
      logger.info('Processing jobs summary:', jobsResult.rows);
    }
    
    // Check email_accounts table
    const accountsQuery = `
      SELECT id, email_address, status, last_sync_at
      FROM email_accounts
      ORDER BY created_at DESC;
    `;
    
    const accountsResult = await db.query(accountsQuery);
    logger.info('Email accounts:', accountsResult.rows);
    
    // Check emails table
    const emailsCountQuery = `
      SELECT account_id, COUNT(*) as email_count
      FROM emails
      GROUP BY account_id;
    `;
    
    const emailsResult = await db.query(emailsCountQuery);
    logger.info('Emails per account:', emailsResult.rows);
    
  } catch (error) {
    logger.error('Error checking database tables:', error);
  } finally {
    await db.end();
  }
}

checkDatabaseTables();