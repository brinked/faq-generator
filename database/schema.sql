-- FAQ Generator Database Schema
-- PostgreSQL with vector extension for embeddings

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- Vector extension (may not be available in all environments)
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "vector";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Vector extension not available - vector columns will be created as TEXT';
END $$;
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CUSTOM TYPES
CREATE TYPE account_status AS ENUM ('active', 'inactive', 'error', 'expired');
CREATE TYPE email_provider AS ENUM ('gmail', 'outlook');
CREATE TYPE processing_status AS ENUM ('pending', 'processing', 'completed', 'failed');

-- FIXED DEFAULT DATABASE SCHEMA
-- Updated: 2025-08-02
-- This includes all the columns and changes made for FAQ generation functionality


-- Table: audit_logs
CREATE TABLE public.audit_logs (id UUID NOT NULL DEFAULT uuid_generate_v4(), table_name VARCHAR(50) NOT NULL, record_id UUID NOT NULL, action VARCHAR(20) NOT NULL, old_values JSONB, new_values JSONB, user_id VARCHAR(100), created_at TIMESTAMP WITH TIME ZONE DEFAULT now());

-- Table: email_accounts
CREATE TABLE public.email_accounts (id UUID NOT NULL DEFAULT uuid_generate_v4(), email_address VARCHAR(255) NOT NULL, provider email_provider NOT NULL, display_name VARCHAR(255), access_token TEXT, refresh_token TEXT, token_expires_at TIMESTAMP WITH TIME ZONE, status account_status DEFAULT 'active'::account_status, last_sync_at TIMESTAMP WITH TIME ZONE, sync_cursor VARCHAR(255), created_at TIMESTAMP WITH TIME ZONE DEFAULT now(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT now());

-- Table: emails (UPDATED with FAQ generation columns)
CREATE TABLE public.emails (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL,
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
    is_processed BOOLEAN DEFAULT false,
    processing_status processing_status DEFAULT 'pending'::processing_status,
    processing_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    -- FAQ Generation columns (ADDED)
    processed_for_faq BOOLEAN NOT NULL DEFAULT false,
    direction VARCHAR(20) DEFAULT 'inbound',
    filtering_status VARCHAR(50) DEFAULT 'pending',
    filtering_reason TEXT,
    has_response BOOLEAN DEFAULT false,
    response_count INTEGER DEFAULT 0,
    is_automated BOOLEAN DEFAULT false,
    is_spam BOOLEAN DEFAULT false,
    quality_score DOUBLE PRECISION DEFAULT 0.0,
    filtering_metadata JSONB
);

-- Table: faq_groups
CREATE TABLE public.faq_groups (id UUID NOT NULL DEFAULT uuid_generate_v4(), title VARCHAR(500) NOT NULL, representative_question TEXT NOT NULL, consolidated_answer TEXT NOT NULL, question_count INTEGER DEFAULT 0, frequency_score DOUBLE PRECISION DEFAULT 0, avg_confidence DOUBLE PRECISION DEFAULT 0, representative_embedding public.vector, is_published BOOLEAN DEFAULT false, category VARCHAR(100), tags TEXT[], sort_order INTEGER DEFAULT 0, view_count INTEGER DEFAULT 0, helpful_count INTEGER DEFAULT 0, not_helpful_count INTEGER DEFAULT 0, created_at TIMESTAMP WITH TIME ZONE DEFAULT now(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT now());

-- Table: processing_jobs
CREATE TABLE public.processing_jobs (id UUID NOT NULL DEFAULT uuid_generate_v4(), job_type VARCHAR(50) NOT NULL, status processing_status DEFAULT 'pending'::processing_status, account_id UUID, parameters JSONB, progress INTEGER DEFAULT 0, total_items INTEGER DEFAULT 0, processed_items INTEGER DEFAULT 0, error_message TEXT, started_at TIMESTAMP WITH TIME ZONE, completed_at TIMESTAMP WITH TIME ZONE, created_at TIMESTAMP WITH TIME ZONE DEFAULT now(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT now());

-- Table: question_groups
CREATE TABLE public.question_groups (question_id UUID NOT NULL, group_id UUID NOT NULL, similarity_score DOUBLE PRECISION, is_representative BOOLEAN DEFAULT false, created_at TIMESTAMP WITH TIME ZONE DEFAULT now());

-- Table: questions
CREATE TABLE public.questions (id UUID NOT NULL DEFAULT uuid_generate_v4(), email_id UUID NOT NULL, question_text TEXT NOT NULL, answer_text TEXT, context_before TEXT, context_after TEXT, confidence_score DOUBLE PRECISION, position_in_email INTEGER, embedding vector, is_customer_question BOOLEAN DEFAULT true, language VARCHAR(10) DEFAULT 'en'::character varying, created_at TIMESTAMP WITH TIME ZONE DEFAULT now(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), sender_email VARCHAR(255), sender_name VARCHAR(255), email_subject TEXT, embedding_vector TEXT, confidence NUMERIC(3,2) DEFAULT 0.5, category VARCHAR(100) DEFAULT 'general'::character varying, detected_at TIMESTAMP WITH TIME ZONE DEFAULT now(), metadata JSONB);

-- Table: system_metrics
CREATE TABLE public.system_metrics (id UUID NOT NULL DEFAULT uuid_generate_v4(), metric_name VARCHAR(100) NOT NULL, metric_value DOUBLE PRECISION, metadata JSONB, created_at TIMESTAMP WITH TIME ZONE DEFAULT now());

-- Table: system_settings
CREATE TABLE public.system_settings (key VARCHAR(100) NOT NULL, value JSONB NOT NULL, description TEXT, updated_at TIMESTAMP WITH TIME ZONE DEFAULT now());

-- CONSTRAINTS
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);
ALTER TABLE email_accounts ADD CONSTRAINT email_accounts_pkey PRIMARY KEY (id);
ALTER TABLE email_accounts ADD CONSTRAINT email_accounts_email_address_key UNIQUE (email_address);
ALTER TABLE emails ADD CONSTRAINT emails_account_id_fkey FOREIGN KEY (account_id) REFERENCES email_accounts (id);
ALTER TABLE emails ADD CONSTRAINT emails_pkey PRIMARY KEY (id);
ALTER TABLE emails ADD CONSTRAINT emails_account_id_message_id_key UNIQUE (account_id, message_id);
ALTER TABLE faq_groups ADD CONSTRAINT faq_groups_pkey PRIMARY KEY (id);
ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_account_id_fkey FOREIGN KEY (account_id) REFERENCES email_accounts (id);
ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_pkey PRIMARY KEY (id);
ALTER TABLE questions ADD CONSTRAINT questions_pkey PRIMARY KEY (id);
ALTER TABLE question_groups ADD CONSTRAINT question_groups_group_id_fkey FOREIGN KEY (group_id) REFERENCES faq_groups (id);
ALTER TABLE question_groups ADD CONSTRAINT question_groups_question_id_fkey FOREIGN KEY (question_id) REFERENCES questions (id);
ALTER TABLE question_groups ADD CONSTRAINT question_groups_pkey PRIMARY KEY (question_id, group_id);
ALTER TABLE questions ADD CONSTRAINT questions_email_id_fkey FOREIGN KEY (email_id) REFERENCES emails (id);
ALTER TABLE questions ADD CONSTRAINT questions_email_question_unique UNIQUE (email_id, question_text);
ALTER TABLE system_metrics ADD CONSTRAINT system_metrics_pkey PRIMARY KEY (id);
ALTER TABLE system_settings ADD CONSTRAINT system_settings_pkey PRIMARY KEY (key);

-- INDEXES
CREATE UNIQUE INDEX email_accounts_email_address_key ON public.email_accounts USING btree (email_address);
CREATE INDEX idx_email_accounts_provider ON public.email_accounts USING btree (provider);
CREATE INDEX idx_email_accounts_status ON public.email_accounts USING btree (status);
CREATE UNIQUE INDEX emails_account_id_message_id_key ON public.emails USING btree (account_id, message_id);
CREATE INDEX idx_emails_account_id ON public.emails USING btree (account_id);
CREATE INDEX idx_emails_account_processed ON public.emails USING btree (account_id, processed_for_faq) WHERE (processed_for_faq = false);
CREATE INDEX idx_emails_processed_for_faq ON public.emails USING btree (processed_for_faq) WHERE (processed_for_faq = false);
CREATE INDEX idx_emails_processing_status ON public.emails USING btree (processing_status);
-- FAQ Generation indexes (ADDED)
CREATE INDEX idx_emails_filtering_status ON public.emails USING btree (filtering_status);
CREATE INDEX idx_emails_has_response ON public.emails USING btree (has_response);
CREATE INDEX idx_emails_direction ON public.emails USING btree (direction);
CREATE INDEX idx_faq_groups_published ON public.faq_groups USING btree (is_published);
CREATE INDEX idx_faq_groups_sort_order ON public.faq_groups USING btree (sort_order);
CREATE INDEX idx_processing_jobs_status ON public.processing_jobs USING btree (status);
CREATE INDEX idx_questions_category ON public.questions USING btree (category);
CREATE INDEX idx_questions_confidence ON public.questions USING btree (confidence_score);
CREATE INDEX idx_questions_detected_at ON public.questions USING btree (detected_at);
CREATE INDEX idx_questions_email_id ON public.questions USING btree (email_id);
CREATE INDEX idx_questions_email_subject ON public.questions USING btree (email_subject);
CREATE INDEX idx_questions_sender_email ON public.questions USING btree (sender_email);
CREATE UNIQUE INDEX questions_email_question_unique ON public.questions USING btree (email_id, question_text);
