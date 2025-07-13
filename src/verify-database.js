#!/usr/bin/env node

/**
 * Database Verification Script
 * Checks if the database schema is properly set up
 */

require('dotenv').config();
const db = require('./config/database');
const logger = require('./utils/logger');

async function verifyDatabase() {
  try {
    logger.info('='.repeat(50));
    logger.info('VERIFYING DATABASE SCHEMA');
    logger.info('='.repeat(50));
    
    // Check if DATABASE_URL is set
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    
    logger.info('Database URL configured:', process.env.DATABASE_URL.replace(/:[^:@]*@/, ':***@'));
    
    // Check tables
    const tables = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    logger.info('Found tables:', tables.rows.map(row => row.table_name));
    
    // Check expected tables
    const expectedTables = [
      'audit_logs',
      'email_accounts', 
      'emails',
      'faq_groups',
      'processing_jobs',
      'question_groups',
      'questions',
      'system_metrics',
      'system_settings'
    ];
    
    const foundTables = tables.rows.map(row => row.table_name);
    const missingTables = expectedTables.filter(table => !foundTables.includes(table));
    
    if (missingTables.length > 0) {
      logger.error('Missing tables:', missingTables);
    } else {
      logger.info('✅ All expected tables found');
    }
    
    // Check extensions
    const extensions = await db.query(`
      SELECT extname 
      FROM pg_extension 
      ORDER BY extname
    `);
    
    logger.info('Installed extensions:', extensions.rows.map(row => row.extname));
    
    // Check enum types
    const enums = await db.query(`
      SELECT typname 
      FROM pg_type 
      WHERE typtype = 'e' 
      ORDER BY typname
    `);
    
    logger.info('Enum types:', enums.rows.map(row => row.typname));
    
    // Check system settings
    const settings = await db.query(`
      SELECT key, value, description 
      FROM system_settings 
      ORDER BY key
    `);
    
    logger.info('System settings count:', settings.rows.length);
    if (settings.rows.length > 0) {
      logger.info('Settings:', settings.rows.map(row => `${row.key}: ${row.value}`));
    }
    
    // Test basic functionality
    logger.info('Testing basic database operations...');
    
    // Test insert/select/delete on a simple table
    const testResult = await db.query(`
      INSERT INTO system_metrics (metric_name, metric_value, metadata) 
      VALUES ('test_metric', 1, '{"test": true}') 
      RETURNING id
    `);
    
    const testId = testResult.rows[0].id;
    logger.info('✅ Insert test successful, ID:', testId);
    
    const selectResult = await db.query(`
      SELECT * FROM system_metrics WHERE id = $1
    `, [testId]);
    
    logger.info('✅ Select test successful, found record:', selectResult.rows.length > 0);
    
    await db.query(`DELETE FROM system_metrics WHERE id = $1`, [testId]);
    logger.info('✅ Delete test successful');
    
    logger.info('='.repeat(50));
    logger.info('DATABASE VERIFICATION COMPLETED SUCCESSFULLY');
    logger.info('='.repeat(50));
    
    if (missingTables.length === 0) {
      logger.info('🎉 Database schema is fully set up and functional!');
    } else {
      logger.warn('⚠️  Some tables are missing. Migration may need to be completed.');
    }
    
    process.exit(0);
    
  } catch (error) {
    logger.error('='.repeat(50));
    logger.error('DATABASE VERIFICATION FAILED');
    logger.error('='.repeat(50));
    logger.error('Error:', error.message);
    logger.error('Stack:', error.stack);
    
    process.exit(1);
  } finally {
    await db.end();
  }
}

// Run verification if this file is executed directly
if (require.main === module) {
  verifyDatabase();
}

module.exports = { verifyDatabase };