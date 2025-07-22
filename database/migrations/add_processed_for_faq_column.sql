-- Migration: Add processed_for_faq column to emails table
-- This column tracks whether an email has been processed for FAQ generation

-- Add the column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'emails' 
        AND column_name = 'processed_for_faq'
    ) THEN
        ALTER TABLE emails 
        ADD COLUMN processed_for_faq BOOLEAN DEFAULT FALSE;
        
        -- Create index for better query performance
        CREATE INDEX idx_emails_processed_for_faq 
        ON emails(processed_for_faq) 
        WHERE processed_for_faq = FALSE;
        
        RAISE NOTICE 'Added processed_for_faq column to emails table';
    ELSE
        RAISE NOTICE 'processed_for_faq column already exists';
    END IF;
END $$;

-- Add processed_at column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'emails' 
        AND column_name = 'processed_at'
    ) THEN
        ALTER TABLE emails 
        ADD COLUMN processed_at TIMESTAMP WITH TIME ZONE;
        
        RAISE NOTICE 'Added processed_at column to emails table';
    ELSE
        RAISE NOTICE 'processed_at column already exists';
    END IF;
END $$;

-- Add processing_error column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'emails' 
        AND column_name = 'processing_error'
    ) THEN
        ALTER TABLE emails 
        ADD COLUMN processing_error TEXT;
        
        RAISE NOTICE 'Added processing_error column to emails table';
    ELSE
        RAISE NOTICE 'processing_error column already exists';
    END IF;
END $$;

-- Update any NULL values to FALSE for processed_for_faq
UPDATE emails 
SET processed_for_faq = FALSE 
WHERE processed_for_faq IS NULL;

-- Add NOT NULL constraint after setting defaults
ALTER TABLE emails 
ALTER COLUMN processed_for_faq SET NOT NULL;

-- Create composite index for efficient querying
CREATE INDEX IF NOT EXISTS idx_emails_account_processed 
ON emails(account_id, processed_for_faq) 
WHERE processed_for_faq = FALSE;

-- Grant permissions if needed
GRANT SELECT, UPDATE ON emails TO PUBLIC;

-- Verify the migration
DO $$
DECLARE
    col_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO col_count
    FROM information_schema.columns 
    WHERE table_name = 'emails' 
    AND column_name IN ('processed_for_faq', 'processed_at', 'processing_error');
    
    IF col_count = 3 THEN
        RAISE NOTICE 'Migration completed successfully - all columns added';
    ELSE
        RAISE EXCEPTION 'Migration failed - expected 3 columns, found %', col_count;
    END IF;
END $$;