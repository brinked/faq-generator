-- FAQ Generator Database Schema
-- PostgreSQL with vector extension for embeddings

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
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
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
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
    UNIQUE(account_id, message_id),
    
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
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
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
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
);

-- Junction table for questions and FAQ groups
CREATE TABLE question_groups (
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES faq_groups(id) ON DELETE CASCADE,
    similarity_score FLOAT CHECK (similarity_score >= 0 AND similarity_score <= 1),
    is_representative BOOLEAN DEFAULT FALSE, -- Is this the representative question for the group?
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    PRIMARY KEY (question_id, group_id),
    
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
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
);

-- System metrics table for tracking scheduled job performance
CREATE TABLE system_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    metric_name VARCHAR(100) NOT NULL,
    metric_value NUMERIC NOT NULL DEFAULT 0,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
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
('faq_auto_publish_threshold', '5', 'Minimum question count for auto-publishing FAQs');

-- Create indexes for performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emails_full_text ON emails USING gin(to_tsvector('english', COALESCE(subject, '') || ' ' || COALESCE(body_text, '')));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_questions_embedding_hnsw ON questions USING hnsw (embedding vector_cosine_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_faq_groups_embedding_hnsw ON faq_groups USING hnsw (representative_embedding vector_cosine_ops);

-- Create indexes separately after table creation
-- Email accounts indexes
CREATE INDEX IF NOT EXISTS idx_email_accounts_provider ON email_accounts(provider);
CREATE INDEX IF NOT EXISTS idx_email_accounts_status ON email_accounts(status);
CREATE INDEX IF NOT EXISTS idx_email_accounts_created ON email_accounts(created_at DESC);

-- Emails indexes
CREATE INDEX IF NOT EXISTS idx_emails_account_id ON emails(account_id);
CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_received_at ON emails(received_at);
CREATE INDEX IF NOT EXISTS idx_emails_processing_status ON emails(processing_status);
CREATE INDEX IF NOT EXISTS idx_emails_is_processed ON emails(is_processed);
CREATE INDEX IF NOT EXISTS idx_emails_sender_email ON emails(sender_email);

-- Full-text search indexes for emails
CREATE INDEX IF NOT EXISTS idx_emails_subject_gin ON emails USING gin(to_tsvector('english', subject));
CREATE INDEX IF NOT EXISTS idx_emails_body_gin ON emails USING gin(to_tsvector('english', body_text));

-- Questions indexes
CREATE INDEX IF NOT EXISTS idx_questions_email_id ON questions(email_id);
CREATE INDEX IF NOT EXISTS idx_questions_confidence ON questions(confidence_score);
CREATE INDEX IF NOT EXISTS idx_questions_is_customer ON questions(is_customer_question);
CREATE INDEX IF NOT EXISTS idx_questions_embedding_cosine ON questions USING ivfflat (embedding vector_cosine_ops);

-- Full-text search index for questions
CREATE INDEX IF NOT EXISTS idx_questions_text_gin ON questions USING gin(to_tsvector('english', question_text));

-- FAQ groups indexes
CREATE INDEX IF NOT EXISTS idx_faq_groups_frequency ON faq_groups(frequency_score DESC);
CREATE INDEX IF NOT EXISTS idx_faq_groups_published ON faq_groups(is_published);
CREATE INDEX IF NOT EXISTS idx_faq_groups_category ON faq_groups(category);
CREATE INDEX IF NOT EXISTS idx_faq_groups_embedding_cosine ON faq_groups USING ivfflat (representative_embedding vector_cosine_ops);

-- Full-text search index for FAQ groups
CREATE INDEX IF NOT EXISTS idx_faq_groups_search_gin ON faq_groups USING gin(to_tsvector('english', title || ' ' || representative_question || ' ' || consolidated_answer));

-- Question groups indexes
CREATE INDEX IF NOT EXISTS idx_question_groups_group_id ON question_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_question_groups_similarity ON question_groups(similarity_score DESC);
CREATE INDEX IF NOT EXISTS idx_question_groups_representative ON question_groups(is_representative);

-- Processing jobs indexes
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_type ON processing_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_account ON processing_jobs(account_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_created ON processing_jobs(created_at DESC);

-- Audit logs indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record ON audit_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- System metrics indexes
CREATE INDEX IF NOT EXISTS idx_system_metrics_name ON system_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_system_metrics_created ON system_metrics(created_at DESC);