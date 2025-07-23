-- Migration: Add email filtering fields
-- Description: Adds fields to support enhanced email filtering and thread analysis
-- Date: 2024-01-22

-- Add email direction tracking (if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'emails' 
                   AND column_name = 'direction') THEN
        ALTER TABLE emails 
        ADD COLUMN direction VARCHAR(20) DEFAULT 'inbound' 
        CHECK (direction IN ('inbound', 'outbound'));
    END IF;
END $$;

-- Add filtering status (if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'emails' 
                   AND column_name = 'filtering_status') THEN
        ALTER TABLE emails 
        ADD COLUMN filtering_status VARCHAR(50) DEFAULT 'pending';
    END IF;
END $$;

-- Add filtering reason (if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'emails' 
                   AND column_name = 'filtering_reason') THEN
        ALTER TABLE emails 
        ADD COLUMN filtering_reason TEXT;
    END IF;
END $$;

-- Add has_response flag (if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'emails' 
                   AND column_name = 'has_response') THEN
        ALTER TABLE emails 
        ADD COLUMN has_response BOOLEAN DEFAULT false;
    END IF;
END $$;

-- Add response_count (if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'emails' 
                   AND column_name = 'response_count') THEN
        ALTER TABLE emails 
        ADD COLUMN response_count INTEGER DEFAULT 0;
    END IF;
END $$;

-- Add is_automated flag (if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'emails' 
                   AND column_name = 'is_automated') THEN
        ALTER TABLE emails 
        ADD COLUMN is_automated BOOLEAN DEFAULT false;
    END IF;
END $$;

-- Add is_spam flag (if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'emails' 
                   AND column_name = 'is_spam') THEN
        ALTER TABLE emails 
        ADD COLUMN is_spam BOOLEAN DEFAULT false;
    END IF;
END $$;

-- Add quality_score (if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'emails' 
                   AND column_name = 'quality_score') THEN
        ALTER TABLE emails 
        ADD COLUMN quality_score DOUBLE PRECISION DEFAULT 1.0;
    END IF;
END $$;

-- Create index for filtering status
CREATE INDEX IF NOT EXISTS idx_emails_filtering_status 
ON emails(filtering_status) 
WHERE filtering_status != 'completed';

-- Create index for has_response
CREATE INDEX IF NOT EXISTS idx_emails_has_response 
ON emails(has_response) 
WHERE has_response = true;

-- Create index for direction
CREATE INDEX IF NOT EXISTS idx_emails_direction 
ON emails(direction);

-- Create composite index for efficient filtering queries
CREATE INDEX IF NOT EXISTS idx_emails_filtering_composite 
ON emails(account_id, processed_for_faq, has_response, is_automated, is_spam) 
WHERE processed_for_faq = false;

-- Add comment to explain the fields
COMMENT ON COLUMN emails.direction IS 'Email direction: inbound (from customer) or outbound (from business)';
COMMENT ON COLUMN emails.filtering_status IS 'Current filtering status: pending, qualified, filtered_out, error';
COMMENT ON COLUMN emails.filtering_reason IS 'Reason for filtering decision';
COMMENT ON COLUMN emails.has_response IS 'Whether this email has received a response from the business';
COMMENT ON COLUMN emails.response_count IS 'Number of responses this email has received';
COMMENT ON COLUMN emails.is_automated IS 'Whether this email appears to be automated';
COMMENT ON COLUMN emails.is_spam IS 'Whether this email appears to be spam';
COMMENT ON COLUMN emails.quality_score IS 'Email quality score for FAQ generation (0-1)';