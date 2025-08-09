-- Migration: Add/Replace update_faq_group_stats function
-- Purpose: Ensures the function required by FAQ generation exists in production
-- Safe to run multiple times

-- Drop any existing variant to avoid signature conflicts
DROP FUNCTION IF EXISTS public.update_faq_group_stats(uuid);

-- Create the function with the expected signature
CREATE OR REPLACE FUNCTION public.update_faq_group_stats(group_uuid uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Update aggregate stats for a single FAQ group
  UPDATE public.faq_groups
  SET
    question_count = (
      SELECT COUNT(*)
      FROM public.question_groups
      WHERE group_id = group_uuid
    ),
    avg_confidence = (
      SELECT AVG(q.confidence_score)
      FROM public.questions q
      JOIN public.question_groups qg ON q.id = qg.question_id
      WHERE qg.group_id = group_uuid
    ),
    frequency_score = (
      SELECT COUNT(*) * COALESCE(AVG(q.confidence_score), 0)
      FROM public.questions q
      JOIN public.question_groups qg ON q.id = qg.question_id
      WHERE qg.group_id = group_uuid
    ),
    updated_at = NOW()
  WHERE id = group_uuid;
END;
$$;

COMMENT ON FUNCTION public.update_faq_group_stats(uuid)
IS 'Recalculates question_count, avg_confidence, and frequency_score for a FAQ group';


