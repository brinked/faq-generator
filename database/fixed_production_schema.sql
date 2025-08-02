-- CUSTOM ENUM TYPES
CREATE TYPE account_status AS ENUM ('active', 'inactive', 'error', 'expired');
CREATE TYPE email_provider AS ENUM ('gmail', 'outlook');
CREATE TYPE processing_status AS ENUM ('pending', 'processing', 'completed', 'failed');

-- TABLE DEFINITIONS
CREATE TABLE public.audit_logs (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    table_name VARCHAR(50) NOT NULL,
    record_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL,
    old_values JSONB,
    new_values JSONB,
    user_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE public.email_accounts (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    email_address VARCHAR(255) NOT NULL,
    provider email_provider NOT NULL,
    display_name VARCHAR(255),
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    status account_status DEFAULT 'active',
    last_sync_at TIMESTAMP WITH TIME ZONE,
    sync_cursor VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

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
    processing_status processing_status DEFAULT 'pending',
    processing_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    processed_for_faq BOOLEAN NOT NULL DEFAULT false,
    processed_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE emails ADD COLUMN direction VARCHAR(10) CHECK (direction IN ('inbound', 'outbound')) DEFAULT 'inbound';


CREATE TABLE public.faq_groups (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    title VARCHAR(500) NOT NULL,
    representative_question TEXT NOT NULL,
    consolidated_answer TEXT NOT NULL,
    question_count INTEGER DEFAULT 0,
    frequency_score DOUBLE PRECISION DEFAULT 0,
    avg_confidence DOUBLE PRECISION DEFAULT 0,
    representative_embedding vector,
    is_published BOOLEAN DEFAULT false,
    category VARCHAR(100),
    tags TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE public.processing_jobs (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    job_type VARCHAR(50) NOT NULL,
    status processing_status DEFAULT 'pending',
    account_id UUID,
    parameters JSONB,
    progress INTEGER DEFAULT 0,
    total_items INTEGER DEFAULT 0,
    processed_items INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE public.questions (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    email_id UUID NOT NULL,
    question_text TEXT NOT NULL,
    answer_text TEXT,
    context_before TEXT,
    context_after TEXT,
    confidence_score DOUBLE PRECISION,
    position_in_email INTEGER,
    embedding vector,
    is_customer_question BOOLEAN DEFAULT true,
    language VARCHAR(10) DEFAULT 'en',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    sender_email VARCHAR(255),
    sender_name VARCHAR(255),
    email_subject TEXT,
    embedding_vector TEXT,
    confidence NUMERIC(3,2) DEFAULT 0.5,
    category VARCHAR(100) DEFAULT 'general',
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    metadata JSONB
);

CREATE TABLE public.question_groups (
    question_id UUID NOT NULL,
    group_id UUID NOT NULL,
    similarity_score DOUBLE PRECISION,
    is_representative BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE public.system_metrics (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    metric_name VARCHAR(100) NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE public.system_settings (
    key VARCHAR(100) NOT NULL,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- PRIMARY KEYS
ALTER TABLE audit_logs ADD PRIMARY KEY (id);
ALTER TABLE email_accounts ADD PRIMARY KEY (id);
ALTER TABLE emails ADD PRIMARY KEY (id);
ALTER TABLE faq_groups ADD PRIMARY KEY (id);
ALTER TABLE processing_jobs ADD PRIMARY KEY (id);
ALTER TABLE questions ADD PRIMARY KEY (id);
ALTER TABLE question_groups ADD PRIMARY KEY (question_id, group_id);
ALTER TABLE system_metrics ADD PRIMARY KEY (id);
ALTER TABLE system_settings ADD PRIMARY KEY (key);

-- UNIQUE CONSTRAINTS
ALTER TABLE email_accounts ADD CONSTRAINT email_accounts_email_address_key UNIQUE (email_address);
ALTER TABLE email_accounts ADD CONSTRAINT email_accounts_email_provider_unique UNIQUE (email_address, provider);

ALTER TABLE emails ADD CONSTRAINT emails_account_id_message_id_key UNIQUE (account_id, message_id);
ALTER TABLE questions ADD CONSTRAINT questions_email_question_unique UNIQUE (email_id, question_text);

-- FOREIGN KEYS
ALTER TABLE emails ADD CONSTRAINT emails_account_id_fkey FOREIGN KEY (account_id) REFERENCES email_accounts (id);
ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_account_id_fkey FOREIGN KEY (account_id) REFERENCES email_accounts (id);
ALTER TABLE questions ADD CONSTRAINT questions_email_id_fkey FOREIGN KEY (email_id) REFERENCES emails (id);
ALTER TABLE question_groups ADD CONSTRAINT question_groups_group_id_fkey FOREIGN KEY (group_id) REFERENCES faq_groups (id);
ALTER TABLE question_groups ADD CONSTRAINT question_groups_question_id_fkey FOREIGN KEY (question_id) REFERENCES questions (id);
