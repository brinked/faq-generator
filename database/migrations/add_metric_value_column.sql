-- Migration: Add metric_value column to system_metrics table
-- Date: 2025-08-01
-- Description: Adds the missing metric_value column that the application expects

-- Add metric_value column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'system_metrics' 
        AND column_name = 'metric_value'
    ) THEN
        ALTER TABLE system_metrics ADD COLUMN metric_value TEXT;
        RAISE NOTICE 'Added metric_value column to system_metrics table';
    ELSE
        RAISE NOTICE 'metric_value column already exists in system_metrics table';
    END IF;
END $$; 