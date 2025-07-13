#!/usr/bin/env node

/**
 * Database Migration Script for Render.com
 * This script creates the database schema directly without external dependencies
 */

require('dotenv').config();
const db = require('./config/database');
const logger = require('./utils/logger');

// Inline schema definition (fixed version without syntax errors)
const SCHEMA_SQL = `
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create enum types
CREATE TYPE email_provider AS ENUM ('gmail', 'outlook');
CREATE TYPE processing_status AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE account_status AS ENUM ('active', 'inactive', 'error', 'expired');

-- Email accounts table
CREATE TABLE email_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email_address VARCHAR(255) NOT NULL UNIQUE,
    provider email_provider NOT NULL,
    display_name VARCHAR(255),
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    status account_status DEFAULT 'active',
    last_sync_at TIMESTAMP WITH TIME ZONE,
    sync_cursor VARCHAR(255), -- For incremental sync
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Emails table
CREATE TABLE emails (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
    message_id VARCHAR(255) NOT NULL, -- Provider's message ID
    thread_id VARCHAR(255),
    subject TEXT,
    body_text TEXT,
    body_html TEXT,
    sender_email VARCHAR(255),
    sender_name VARCHAR(255),
    recipient_emails TEXT[], -- Array of recipient emails
    cc_emails TEXT[],
    bcc_emails TEXT[],
    received_at TIMESTAMP WITH TIME ZONE,
    sent_at TIMESTAMP WITH TIME ZONE,
    is_processed BOOLEAN DEFAULT FALSE,
    processing_status processing_status DEFAULT 'pending',
    processing_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint on account + message_id
    UNIQUE(account_id, message_id)
);

-- Questions extracted from emails
CREATE TABLE questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email_id UUID NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    answer_text TEXT,
    context_before TEXT, -- Text before the question for context
    context_after TEXT, -- Text after the question for context
    confidence_score FLOAT CHECK (confidence_score >= 0 AND confidence_score <= 1),
    position_in_email INTEGER, -- Position of question in email
    embedding vector(1536), -- OpenAI embedding dimension
    is_customer_question BOOLEAN DEFAULT TRUE,
    language VARCHAR(10) DEFAULT 'en',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- FAQ groups (clusters of similar questions)
CREATE TABLE faq_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(500) NOT NULL,
    representative_question TEXT NOT NULL,
    consolidated_answer TEXT NOT NULL,
    question_count INTEGER DEFAULT 0,
    frequency_score FLOAT DEFAULT 0,
    avg_confidence FLOAT DEFAULT 0,
    representative_embedding vector(1536),
    is_published BOOLEAN DEFAULT FALSE,
    category VARCHAR(100),
    tags TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Junction table for questions and FAQ groups
CREATE TABLE question_groups (
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES faq_groups(id) ON DELETE CASCADE,
    similarity_score FLOAT CHECK (similarity_score >= 0 AND similarity_score <= 1),
    is_representative BOOLEAN DEFAULT FALSE, -- Is this the representative question for the group?
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    PRIMARY KEY (question_id, group_id)
);

-- Processing jobs table for background tasks
CREATE TABLE processing_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_type VARCHAR(50) NOT NULL, -- 'email_sync', 'question_extraction', 'faq_generation'
    status processing_status DEFAULT 'pending',
    account_id UUID REFERENCES email_accounts(id) ON DELETE CASCADE,
    parameters JSONB, -- Job-specific parameters
    progress INTEGER DEFAULT 0, -- Progress percentage
    total_items INTEGER DEFAULT 0,
    processed_items INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- System settings table
CREATE TABLE system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Audit log table
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name VARCHAR(50) NOT NULL,
    record_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
    old_values JSONB,
    new_values JSONB,
    user_id VARCHAR(100), -- For future user management
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- System metrics table for tracking scheduled job performance
CREATE TABLE system_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    metric_name VARCHAR(100) NOT NULL,
    metric_value NUMERIC NOT NULL DEFAULT 0,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create functions for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_email_accounts_updated_at BEFORE UPDATE ON email_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_emails_updated_at BEFORE UPDATE ON emails FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_questions_updated_at BEFORE UPDATE ON questions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_faq_groups_updated_at BEFORE UPDATE ON faq_groups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_processing_jobs_updated_at BEFORE UPDATE ON processing_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_system_settings_updated_at BEFORE UPDATE ON system_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate FAQ group statistics
CREATE OR REPLACE FUNCTION update_faq_group_stats(group_uuid UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE faq_groups 
    SET 
        question_count = (
            SELECT COUNT(*) 
            FROM question_groups 
            WHERE group_id = group_uuid
        ),
        avg_confidence = (
            SELECT AVG(q.confidence_score)
            FROM questions q
            JOIN question_groups qg ON q.id = qg.question_id
            WHERE qg.group_id = group_uuid
        ),
        frequency_score = (
            SELECT COUNT(*) * AVG(q.confidence_score)
            FROM questions q
            JOIN question_groups qg ON q.id = qg.question_id
            WHERE qg.group_id = group_uuid
        )
    WHERE id = group_uuid;
END;
$$ LANGUAGE plpgsql;

-- Function to find similar questions using vector similarity
CREATE OR REPLACE FUNCTION find_similar_questions(
    query_embedding vector(1536),
    similarity_threshold FLOAT DEFAULT 0.8,
    max_results INTEGER DEFAULT 10
)
RETURNS TABLE (
    question_id UUID,
    question_text TEXT,
    similarity_score FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        q.id,
        q.question_text,
        1 - (q.embedding <=> query_embedding) as similarity
    FROM questions q
    WHERE q.embedding IS NOT NULL
        AND 1 - (q.embedding <=> query_embedding) >= similarity_threshold
    ORDER BY q.embedding <=> query_embedding
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- Insert default system settings
INSERT INTO system_settings (key, value, description) VALUES
('similarity_threshold', '0.8', 'Minimum similarity score for grouping questions'),
('min_question_length', '10', 'Minimum length for a valid question'),
('max_question_length', '500', 'Maximum length for a valid question'),
('embedding_model', '"text-embedding-3-small"', 'OpenAI embedding model to use'),
('max_emails_per_sync', '1000', 'Maximum emails to process in one sync'),
('question_confidence_threshold', '0.7', 'Minimum confidence score for question extraction'),
('faq_auto_publish_threshold', '5', 'Minimum question count for auto-publishing FAQs')
ON CONFLICT (key) DO NOTHING;

-- Create basic indexes
CREATE INDEX IF NOT EXISTS idx_email_accounts_provider ON email_accounts(provider);
CREATE INDEX IF NOT EXISTS idx_email_accounts_status ON email_accounts(status);
CREATE INDEX IF NOT EXISTS idx_emails_account_id ON emails(account_id);
CREATE INDEX IF NOT EXISTS idx_emails_processing_status ON emails(processing_status);
CREATE INDEX IF NOT EXISTS idx_questions_email_id ON questions(email_id);
CREATE INDEX IF NOT EXISTS idx_questions_confidence ON questions(confidence_score);
CREATE INDEX IF NOT EXISTS idx_faq_groups_published ON faq_groups(is_published);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status);
`;

async function runMigration() {
  try {
    logger.info('='.repeat(50));
    logger.info('STARTING DATABASE MIGRATION');
    logger.info('='.repeat(50));
    
    // Check if DATABASE_URL is set
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    
    logger.info('Database URL configured:', process.env.DATABASE_URL.replace(/:[^:@]*@/, ':***@'));
    
    // Split the schema into individual statements, handling DO blocks properly
    const statements = [];
    let currentStatement = '';
    let inDoBlock = false;
    
    const lines = SCHEMA_SQL.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip comments and empty lines
      if (trimmedLine.startsWith('--') || trimmedLine === '') {
        continue;
      }
      
      currentStatement += line + '\n';
      
      // Check if we're entering a DO block
      if (trimmedLine.includes('DO $$')) {
        inDoBlock = true;
      }
      
      // Check if we're ending a DO block
      if (inDoBlock && trimmedLine.includes('END $$;')) {
        inDoBlock = false;
        statements.push(currentStatement.trim());
        currentStatement = '';
        continue;
      }
      
      // For non-DO block statements, split on semicolon
      if (!inDoBlock && trimmedLine.endsWith(';')) {
        statements.push(currentStatement.trim());
        currentStatement = '';
      }
    }
    
    // Add any remaining statement
    if (currentStatement.trim()) {
      statements.push(currentStatement.trim());
    }
    
    // Filter out empty statements
    const validStatements = statements.filter(stmt => stmt.length > 0);
    
    logger.info(`Executing ${statements.length} SQL statements...`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement) {
        try {
          logger.info(`Executing statement ${i + 1}/${statements.length}`);
          await db.query(statement + ';');
        } catch (error) {
          // Handle specific error cases
          if (error.message.includes('already exists') || 
              error.message.includes('does not exist') ||
              error.message.includes('extension "vector" is not available')) {
            logger.warn(`Statement ${i + 1} skipped: ${error.message}`);
          } else {
            logger.error(`Error executing statement ${i + 1}:`, error);
            logger.error('Statement content:', statement.substring(0, 200) + '...');
            throw error;
          }
        }
      }
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
    logger.error('Stack:', error.stack);
    
    process.exit(1);
  } finally {
    await db.end();
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };