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
    processed_at TIMESTAMP WITH TIME ZONE,
    processing_error TEXT,
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
-- FUNCTIONS
CREATE OR REPLACE FUNCTION public.array_to_vector(numeric[], integer, boolean)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$array_to_vector$function$


CREATE OR REPLACE FUNCTION public.array_to_vector(integer[], integer, boolean)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$array_to_vector$function$


CREATE OR REPLACE FUNCTION public.array_to_vector(real[], integer, boolean)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$array_to_vector$function$


CREATE OR REPLACE FUNCTION public.array_to_vector(double precision[], integer, boolean)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$array_to_vector$function$


CREATE OR REPLACE FUNCTION public.cosine_distance(vector, vector)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$cosine_distance$function$


CREATE OR REPLACE FUNCTION public.find_similar_questions(query_embedding vector, similarity_threshold double precision DEFAULT 0.8, max_results integer DEFAULT 10)
 RETURNS TABLE(question_id uuid, question_text text, similarity_score double precision)
 LANGUAGE plpgsql
AS $function$
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
$function$


CREATE OR REPLACE FUNCTION public.gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_extract_query_trgm$function$


CREATE OR REPLACE FUNCTION public.gin_extract_value_trgm(text, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_extract_value_trgm$function$


CREATE OR REPLACE FUNCTION public.gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_trgm_consistent$function$


CREATE OR REPLACE FUNCTION public.gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal)
 RETURNS "char"
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_trgm_triconsistent$function$


CREATE OR REPLACE FUNCTION public.gtrgm_compress(internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_compress$function$


CREATE OR REPLACE FUNCTION public.gtrgm_consistent(internal, text, smallint, oid, internal)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_consistent$function$


CREATE OR REPLACE FUNCTION public.gtrgm_decompress(internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_decompress$function$


CREATE OR REPLACE FUNCTION public.gtrgm_distance(internal, text, smallint, oid, internal)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_distance$function$


CREATE OR REPLACE FUNCTION public.gtrgm_in(cstring)
 RETURNS gtrgm
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_in$function$


CREATE OR REPLACE FUNCTION public.gtrgm_options(internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/pg_trgm', $function$gtrgm_options$function$


CREATE OR REPLACE FUNCTION public.gtrgm_out(gtrgm)
 RETURNS cstring
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_out$function$


CREATE OR REPLACE FUNCTION public.gtrgm_penalty(internal, internal, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_penalty$function$


CREATE OR REPLACE FUNCTION public.gtrgm_picksplit(internal, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_picksplit$function$


CREATE OR REPLACE FUNCTION public.gtrgm_same(gtrgm, gtrgm, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_same$function$


CREATE OR REPLACE FUNCTION public.gtrgm_union(internal, internal)
 RETURNS gtrgm
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_union$function$


CREATE OR REPLACE FUNCTION public.hnswhandler(internal)
 RETURNS index_am_handler
 LANGUAGE c
AS '$libdir/vector', $function$hnswhandler$function$


CREATE OR REPLACE FUNCTION public.inner_product(vector, vector)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$inner_product$function$


CREATE OR REPLACE FUNCTION public.ivfflathandler(internal)
 RETURNS index_am_handler
 LANGUAGE c
AS '$libdir/vector', $function$ivfflathandler$function$


CREATE OR REPLACE FUNCTION public.l1_distance(vector, vector)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$l1_distance$function$


CREATE OR REPLACE FUNCTION public.l2_distance(vector, vector)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$l2_distance$function$


CREATE OR REPLACE FUNCTION public.set_limit(real)
 RETURNS real
 LANGUAGE c
 STRICT
AS '$libdir/pg_trgm', $function$set_limit$function$


CREATE OR REPLACE FUNCTION public.show_limit()
 RETURNS real
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$show_limit$function$


CREATE OR REPLACE FUNCTION public.show_trgm(text)
 RETURNS text[]
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$show_trgm$function$


CREATE OR REPLACE FUNCTION public.similarity(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$similarity$function$


CREATE OR REPLACE FUNCTION public.similarity_dist(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$similarity_dist$function$


CREATE OR REPLACE FUNCTION public.similarity_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$similarity_op$function$


CREATE OR REPLACE FUNCTION public.strict_word_similarity(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity$function$


CREATE OR REPLACE FUNCTION public.strict_word_similarity_commutator_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_commutator_op$function$


CREATE OR REPLACE FUNCTION public.strict_word_similarity_dist_commutator_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_dist_commutator_op$function$


CREATE OR REPLACE FUNCTION public.strict_word_similarity_dist_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_dist_op$function$


CREATE OR REPLACE FUNCTION public.strict_word_similarity_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_op$function$


CREATE OR REPLACE FUNCTION public.update_faq_group_stats(group_uuid uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
        BEGIN
          UPDATE faq_groups
          SET 
            question_count = (SELECT COUNT(*) FROM question_groups WHERE group_id = group_uuid),
            updated_at = NOW()
          WHERE id = group_uuid;
        END;
        $function$


CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.uuid_generate_v1()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v1$function$


CREATE OR REPLACE FUNCTION public.uuid_generate_v1mc()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v1mc$function$


CREATE OR REPLACE FUNCTION public.uuid_generate_v3(namespace uuid, name text)
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v3$function$


CREATE OR REPLACE FUNCTION public.uuid_generate_v4()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v4$function$


CREATE OR REPLACE FUNCTION public.uuid_generate_v5(namespace uuid, name text)
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v5$function$


CREATE OR REPLACE FUNCTION public.uuid_generate_v1()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v1$function$


CREATE OR REPLACE FUNCTION public.uuid_generate_v1mc()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v1mc$function$


CREATE OR REPLACE FUNCTION public.uuid_generate_v3(namespace uuid, name text)
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v3$function$


CREATE OR REPLACE FUNCTION public.uuid_generate_v4()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v4$function$


CREATE OR REPLACE FUNCTION public.uuid_generate_v5(namespace uuid, name text)
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v5$function$


CREATE OR REPLACE FUNCTION public.uuid_nil()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_nil$function$


CREATE OR REPLACE FUNCTION public.uuid_ns_dns()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_ns_dns$function$


CREATE OR REPLACE FUNCTION public.uuid_ns_oid()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_ns_oid$function$


CREATE OR REPLACE FUNCTION public.uuid_ns_url()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_ns_url$function$


CREATE OR REPLACE FUNCTION public.uuid_ns_x500()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_ns_x500$function$


CREATE OR REPLACE FUNCTION public.vector(vector, integer, boolean)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector$function$


CREATE OR REPLACE FUNCTION public.vector_accum(double precision[], vector)
 RETURNS double precision[]
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_accum$function$


CREATE OR REPLACE FUNCTION public.vector_add(vector, vector)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_add$function$


CREATE OR REPLACE FUNCTION public.vector_avg(double precision[])
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_avg$function$


CREATE OR REPLACE FUNCTION public.vector_cmp(vector, vector)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_cmp$function$


CREATE OR REPLACE FUNCTION public.vector_combine(double precision[], double precision[])
 RETURNS double precision[]
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_combine$function$


CREATE OR REPLACE FUNCTION public.vector_dims(vector)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_dims$function$


CREATE OR REPLACE FUNCTION public.vector_eq(vector, vector)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_eq$function$


CREATE OR REPLACE FUNCTION public.vector_ge(vector, vector)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_ge$function$


CREATE OR REPLACE FUNCTION public.vector_gt(vector, vector)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_gt$function$


CREATE OR REPLACE FUNCTION public.vector_in(cstring, oid, integer)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_in$function$


CREATE OR REPLACE FUNCTION public.vector_l2_squared_distance(vector, vector)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_l2_squared_distance$function$


CREATE OR REPLACE FUNCTION public.vector_le(vector, vector)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_le$function$


CREATE OR REPLACE FUNCTION public.vector_lt(vector, vector)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_lt$function$


CREATE OR REPLACE FUNCTION public.vector_mul(vector, vector)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_mul$function$


CREATE OR REPLACE FUNCTION public.vector_ne(vector, vector)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_ne$function$


CREATE OR REPLACE FUNCTION public.vector_negative_inner_product(vector, vector)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_negative_inner_product$function$


CREATE OR REPLACE FUNCTION public.vector_norm(vector)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_norm$function$


CREATE OR REPLACE FUNCTION public.vector_out(vector)
 RETURNS cstring
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_out$function$


CREATE OR REPLACE FUNCTION public.vector_recv(internal, oid, integer)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_recv$function$


CREATE OR REPLACE FUNCTION public.vector_send(vector)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_send$function$


CREATE OR REPLACE FUNCTION public.vector_spherical_distance(vector, vector)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_spherical_distance$function$


CREATE OR REPLACE FUNCTION public.vector_sub(vector, vector)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_sub$function$


CREATE OR REPLACE FUNCTION public.vector_to_float4(vector, integer, boolean)
 RETURNS real[]
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_to_float4$function$


CREATE OR REPLACE FUNCTION public.vector_typmod_in(cstring[])
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_typmod_in$function$


CREATE OR REPLACE FUNCTION public.word_similarity(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity$function$


CREATE OR REPLACE FUNCTION public.word_similarity_commutator_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_commutator_op$function$


CREATE OR REPLACE FUNCTION public.word_similarity_dist_commutator_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_dist_commutator_op$function$


CREATE OR REPLACE FUNCTION public.word_similarity_dist_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_dist_op$function$


CREATE OR REPLACE FUNCTION public.word_similarity_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_op$function$



-- TRIGGERS
CREATE TRIGGER update_email_accounts_updated_at BEFORE UPDATE ON public.email_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_emails_updated_at BEFORE UPDATE ON public.emails FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_faq_groups_updated_at BEFORE UPDATE ON public.faq_groups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_processing_jobs_updated_at BEFORE UPDATE ON public.processing_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_questions_updated_at BEFORE UPDATE ON public.questions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_system_settings_updated_at BEFORE UPDATE ON public.system_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();