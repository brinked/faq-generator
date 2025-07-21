-- Migration: Add missing update_faq_group_stats function
-- This function is called by the FAQ service but was missing from the database

-- Create the update_faq_group_stats function
CREATE OR REPLACE FUNCTION update_faq_group_stats(group_id INTEGER)
RETURNS VOID AS $$
BEGIN
    -- Update FAQ group statistics
    UPDATE faq_groups 
    SET 
        question_count = (
            SELECT COUNT(*) 
            FROM questions 
            WHERE faq_group_id = group_id
        ),
        updated_at = NOW()
    WHERE id = group_id;
    
    -- If the group doesn't exist, this will silently do nothing
    -- which is the expected behavior for this function
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION update_faq_group_stats(INTEGER) TO PUBLIC;

-- Create index for better performance if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_questions_faq_group_id ON questions(faq_group_id);
CREATE INDEX IF NOT EXISTS idx_faq_groups_updated_at ON faq_groups(updated_at);

-- Verify the function was created
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM pg_proc p 
        JOIN pg_namespace n ON p.pronamespace = n.oid 
        WHERE n.nspname = 'public' 
        AND p.proname = 'update_faq_group_stats'
    ) THEN
        RAISE NOTICE 'SUCCESS: update_faq_group_stats function created successfully';
    ELSE
        RAISE EXCEPTION 'FAILED: update_faq_group_stats function was not created';
    END IF;
END $$;