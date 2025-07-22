#!/usr/bin/env node

/**
 * Run the missing database migration for processed_for_faq column
 */

const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');
const logger = require('../src/utils/logger');

async function runMigration() {
  try {
    logger.info('🔧 Running missing database migration...');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, '../database/migrations/add_processed_for_faq_column.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    logger.info('📄 Executing migration: add_processed_for_faq_column.sql');
    
    // Execute the migration
    await db.query(migrationSQL);
    
    // Verify the columns exist
    const checkQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'emails' 
      AND column_name IN ('processed_for_faq', 'processed_at', 'processing_error')
      ORDER BY column_name;
    `;
    
    const result = await db.query(checkQuery);
    
    logger.info('✅ Migration completed successfully!');
    logger.info('📊 Columns added:');
    result.rows.forEach(row => {
      logger.info(`   - ${row.column_name}`);
    });
    
    // Check current email stats
    const statsQuery = `
      SELECT 
        COUNT(*) as total_emails,
        COUNT(*) FILTER (WHERE processed_for_faq = true) as processed,
        COUNT(*) FILTER (WHERE processed_for_faq = false) as unprocessed
      FROM emails;
    `;
    
    const stats = await db.query(statsQuery);
    logger.info('\n📈 Email Processing Stats:');
    logger.info(`   Total emails: ${stats.rows[0].total_emails}`);
    logger.info(`   Processed: ${stats.rows[0].processed}`);
    logger.info(`   Unprocessed: ${stats.rows[0].unprocessed}`);
    
    process.exit(0);
    
  } catch (error) {
    logger.error('❌ Migration failed:', error);
    logger.error('Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail
    });
    process.exit(1);
  }
}

// Run the migration
runMigration();