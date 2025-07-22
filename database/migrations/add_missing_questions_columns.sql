-- Migration: Add missing columns to questions table
-- This adds confidence, category, and other missing columns

-- Add confidence column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'questions' 
        AND column_name = 'confidence'
    ) THEN
        ALTER TABLE questions 
        ADD COLUMN confidence DECIMAL(3,2) DEFAULT 0.5;
        
        RAISE NOTICE 'Added confidence column to questions table';
    ELSE
        RAISE NOTICE 'confidence column already exists';
    END IF;
END $$;

-- Add category column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'questions' 
        AND column_name = 'category'
    ) THEN
        ALTER TABLE questions 
        ADD COLUMN category VARCHAR(100) DEFAULT 'general';
        
        RAISE NOTICE 'Added category column to questions table';
    ELSE
        RAISE NOTICE 'category column already exists';
    END IF;
END $$;

-- Add sender_email column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'questions' 
        AND column_name = 'sender_email'
    ) THEN
        ALTER TABLE questions 
        ADD COLUMN sender_email VARCHAR(255);
        
        RAISE NOTICE 'Added sender_email column to questions table';
    ELSE
        RAISE NOTICE 'sender_email column already exists';
    END IF;
END $$;

-- Add sender_name column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'questions' 
        AND column_name = 'sender_name'
    ) THEN
        ALTER TABLE questions 
        ADD COLUMN sender_name VARCHAR(255);
        
        RAISE NOTICE 'Added sender_name column to questions table';
    ELSE
        RAISE NOTICE 'sender_name column already exists';
    END IF;
END $$;

-- Add detected_at column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'questions' 
        AND column_name = 'detected_at'
    ) THEN
        ALTER TABLE questions 
        ADD COLUMN detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        
        RAISE NOTICE 'Added detected_at column to questions table';
    ELSE
        RAISE NOTICE 'detected_at column already exists';
    END IF;
END $$;

-- Add metadata column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'questions' 
        AND column_name = 'metadata'
    ) THEN
        ALTER TABLE questions 
        ADD COLUMN metadata JSONB;
        
        RAISE NOTICE 'Added metadata column to questions table';
    ELSE
        RAISE NOTICE 'metadata column already exists';
    END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_questions_confidence ON questions(confidence);
CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category);
CREATE INDEX IF NOT EXISTS idx_questions_detected_at ON questions(detected_at);

-- Verify all columns exist
DO $$
DECLARE
    col_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO col_count
    FROM information_schema.columns 
    WHERE table_name = 'questions' 
    AND column_name IN ('confidence', 'category', 'sender_email', 'sender_name', 'detected_at', 'metadata');
    
    IF col_count = 6 THEN
        RAISE NOTICE 'Migration completed successfully - all columns added';
    ELSE
        RAISE WARNING 'Migration may be incomplete - expected 6 columns, found %', col_count;
    END IF;
END $$;