-- Add unique constraint for questions table to support ON CONFLICT clauses
-- This migration adds a unique constraint on (email_id, question_text) to prevent duplicate questions per email

-- Check if the constraint already exists before adding it
DO $$
BEGIN
    -- Check if the unique constraint already exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'unique_email_question' 
        AND conrelid = 'questions'::regclass
    ) THEN
        -- Add the unique constraint
        ALTER TABLE questions 
        ADD CONSTRAINT unique_email_question 
        UNIQUE (email_id, question_text);
        
        RAISE NOTICE 'Added unique constraint unique_email_question to questions table';
    ELSE
        RAISE NOTICE 'Unique constraint unique_email_question already exists on questions table';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error adding unique constraint: %', SQLERRM;
END $$;

-- Create an index to improve performance for the constraint
CREATE INDEX IF NOT EXISTS idx_questions_email_question 
ON questions(email_id, question_text);

-- Add comment to document the constraint purpose
COMMENT ON CONSTRAINT unique_email_question ON questions IS 
'Ensures no duplicate questions per email - supports ON CONFLICT clauses in application code';