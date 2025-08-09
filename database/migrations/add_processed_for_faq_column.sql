-- Migration: Ensure processed_for_faq, processed_at, processing_error columns on emails
-- Safe: Uses IF NOT EXISTS; rerunnable

ALTER TABLE IF EXISTS public.emails
  ADD COLUMN IF NOT EXISTS processed_for_faq BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS processing_error TEXT NULL;
