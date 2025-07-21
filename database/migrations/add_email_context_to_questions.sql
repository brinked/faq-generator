-- Migration: Add email context columns to questions table
-- This allows us to track which emails questions came from for the modal popup

-- Add new columns to store email context
ALTER TABLE questions 
ADD COLUMN IF NOT EXISTS sender_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS sender_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS email_subject TEXT;

-- Create index for faster lookups when showing email sources
CREATE INDEX IF NOT EXISTS idx_questions_sender_email ON questions(sender_email);
CREATE INDEX IF NOT EXISTS idx_questions_email_subject ON questions(email_subject);

-- Update existing questions with email context from the emails table
UPDATE questions 
SET 
    sender_email = e.sender_email,
    sender_name = e.sender_name,
    email_subject = e.subject
FROM emails e 
WHERE questions.email_id = e.id 
AND questions.sender_email IS NULL;