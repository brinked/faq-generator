#!/usr/bin/env node

/**
 * Simple Database Migration Script for Render.com
 * This script creates the database schema without complex parsing
 */

require('dotenv').config();
const db = require('./config/database');
const logger = require('./utils/logger');

async function runSimpleMigration() {
  try {
    logger.info('='.repeat(50));
    logger.info('STARTING SIMPLE DATABASE MIGRATION');
    logger.info('='.repeat(50));
    
    // Check if DATABASE_URL is set
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    
    logger.info('Database URL configured:', process.env.DATABASE_URL.replace(/:[^:@]*@/, ':***@'));
    
    // Execute statements one by one with proper error handling
    const statements = [
      // Extensions
      `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`,
      `CREATE EXTENSION IF NOT EXISTS "pg_trgm"`,
      
      // Try vector extension (may fail, that's ok)
      `CREATE EXTENSION IF NOT EXISTS "vector"`,
      
      // Enum types
      `CREATE TYPE email_provider AS ENUM ('gmail', 'outlook')`,
      `CREATE TYPE processing_status AS ENUM ('pending', 'processing', 'completed', 'failed')`,
      `CREATE TYPE account_status AS ENUM ('active', 'inactive', 'error', 'expired')`,
      
      // Email accounts table
      `CREATE TABLE email_accounts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email_address VARCHAR(255) NOT NULL UNIQUE,
        provider email_provider NOT NULL,
        display_name VARCHAR(255),
        access_token TEXT,
        refresh_token TEXT,
        token_expires_at TIMESTAMP WITH TIME ZONE,
        status account_status DEFAULT 'active',
        last_sync_at TIMESTAMP WITH TIME ZONE,
        sync_cursor VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`,
      
      // Emails table
      `CREATE TABLE emails (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
        message_id VARCHAR(255) NOT NULL,
        thread_id VARCHAR(255),
        subject TEXT,
        body_text TEXT,
        body_html TEXT,
        sender_email VARCHAR(255),
        sender_name VARCHAR(255),
        recipient_emails TEXT[],
        cc_emails TEXT[],
        bcc_emails TEXT[],
        received_at TIMESTAMP WITH TIME ZONE,
        sent_at TIMESTAMP WITH TIME ZONE,
        is_processed BOOLEAN DEFAULT FALSE,
        processing_status processing_status DEFAULT 'pending',
        processing_error TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(account_id, message_id)
      )`,
      
      // Questions table
      `CREATE TABLE questions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email_id UUID NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
        question_text TEXT NOT NULL,
        answer_text TEXT,
        context_before TEXT,
        context_after TEXT,
        confidence_score FLOAT CHECK (confidence_score >= 0 AND confidence_score <= 1),
        position_in_email INTEGER,
        embedding TEXT,
        is_customer_question BOOLEAN DEFAULT TRUE,
        language VARCHAR(10) DEFAULT 'en',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`,
      
      // FAQ groups table
      `CREATE TABLE faq_groups (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        title VARCHAR(500) NOT NULL,
        representative_question TEXT NOT NULL,
        consolidated_answer TEXT NOT NULL,
        question_count INTEGER DEFAULT 0,
        frequency_score FLOAT DEFAULT 0,
        avg_confidence FLOAT DEFAULT 0,
        representative_embedding TEXT,
        is_published BOOLEAN DEFAULT FALSE,
        category VARCHAR(100),
        tags TEXT[],
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`,
      
      // Question groups junction table
      `CREATE TABLE question_groups (
        question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        group_id UUID NOT NULL REFERENCES faq_groups(id) ON DELETE CASCADE,
        similarity_score FLOAT CHECK (similarity_score >= 0 AND similarity_score <= 1),
        is_representative BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        PRIMARY KEY (question_id, group_id)
      )`,
      
      // Processing jobs table
      `CREATE TABLE processing_jobs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        job_type VARCHAR(50) NOT NULL,
        status processing_status DEFAULT 'pending',
        account_id UUID REFERENCES email_accounts(id) ON DELETE CASCADE,
        parameters JSONB,
        progress INTEGER DEFAULT 0,
        total_items INTEGER DEFAULT 0,
        processed_items INTEGER DEFAULT 0,
        error_message TEXT,
        started_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`,
      
      // System settings table
      `CREATE TABLE system_settings (
        key VARCHAR(100) PRIMARY KEY,
        value JSONB NOT NULL,
        description TEXT,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`,
      
      // Audit logs table
      `CREATE TABLE audit_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        table_name VARCHAR(50) NOT NULL,
        record_id UUID NOT NULL,
        action VARCHAR(20) NOT NULL,
        old_values JSONB,
        new_values JSONB,
        user_id VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`,
      
      // System metrics table
      `CREATE TABLE system_metrics (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        metric_name VARCHAR(100) NOT NULL,
        metric_value NUMERIC NOT NULL DEFAULT 0,
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`,
      
      // Basic indexes
      `CREATE INDEX IF NOT EXISTS idx_email_accounts_provider ON email_accounts(provider)`,
      `CREATE INDEX IF NOT EXISTS idx_email_accounts_status ON email_accounts(status)`,
      `CREATE INDEX IF NOT EXISTS idx_emails_account_id ON emails(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_emails_processing_status ON emails(processing_status)`,
      `CREATE INDEX IF NOT EXISTS idx_questions_email_id ON questions(email_id)`,
      `CREATE INDEX IF NOT EXISTS idx_questions_confidence ON questions(confidence_score)`,
      `CREATE INDEX IF NOT EXISTS idx_faq_groups_published ON faq_groups(is_published)`,
      `CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status)`
    ];
    
    // Insert default settings
    const settingsInsert = `
      INSERT INTO system_settings (key, value, description) VALUES
      ('similarity_threshold', '0.8', 'Minimum similarity score for grouping questions'),
      ('min_question_length', '10', 'Minimum length for a valid question'),
      ('max_question_length', '500', 'Maximum length for a valid question'),
      ('embedding_model', '"text-embedding-3-small"', 'OpenAI embedding model to use'),
      ('max_emails_per_sync', '1000', 'Maximum emails to process in one sync'),
      ('question_confidence_threshold', '0.7', 'Minimum confidence score for question extraction'),
      ('faq_auto_publish_threshold', '5', 'Minimum question count for auto-publishing FAQs')
      ON CONFLICT (key) DO NOTHING
    `;
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      try {
        logger.info(`Executing statement ${i + 1}/${statements.length}: ${statement.substring(0, 50)}...`);
        await db.query(statement);
        logger.info(`✅ Statement ${i + 1} completed successfully`);
      } catch (error) {
        if (error.message.includes('already exists') || 
            error.message.includes('does not exist') ||
            error.message.includes('extension "vector" is not available')) {
          logger.warn(`⚠️  Statement ${i + 1} skipped: ${error.message}`);
        } else {
          logger.error(`❌ Error executing statement ${i + 1}:`, error.message);
          throw error;
        }
      }
    }
    
    // Insert default settings
    try {
      logger.info('Inserting default system settings...');
      await db.query(settingsInsert);
      logger.info('✅ Default settings inserted successfully');
    } catch (error) {
      logger.warn('⚠️  Settings insert skipped:', error.message);
    }
    
    // Verify the migration by checking if tables exist
    const tables = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    logger.info('='.repeat(50));
    logger.info('DATABASE MIGRATION COMPLETED SUCCESSFULLY');
    logger.info('='.repeat(50));
    logger.info('Created tables:', tables.rows.map(row => row.table_name));
    
    process.exit(0);
    
  } catch (error) {
    logger.error('='.repeat(50));
    logger.error('DATABASE MIGRATION FAILED');
    logger.error('='.repeat(50));
    logger.error('Error:', error.message);
    
    process.exit(1);
  } finally {
    await db.end();
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  runSimpleMigration();
}

module.exports = { runSimpleMigration };