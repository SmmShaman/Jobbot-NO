-- Exports history table for storing exported files metadata
-- Run this in Supabase SQL Editor

-- Create exports bucket in Storage (run in Storage settings or via SQL)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('exports', 'exports', true);

-- Create exports_history table
CREATE TABLE IF NOT EXISTS exports_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('xlsx', 'pdf')),
    file_path TEXT NOT NULL,
    file_size INTEGER,
    jobs_count INTEGER NOT NULL DEFAULT 0,
    filters_applied JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_exports_history_user_id ON exports_history(user_id);
CREATE INDEX IF NOT EXISTS idx_exports_history_created_at ON exports_history(created_at DESC);

-- Enable RLS
ALTER TABLE exports_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies - users can only see their own exports
CREATE POLICY "Users can view own exports"
    ON exports_history FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own exports"
    ON exports_history FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own exports"
    ON exports_history FOR DELETE
    USING (auth.uid() = user_id);

-- Create storage bucket for exports (if not exists)
-- Note: Run this separately or in Supabase Dashboard -> Storage
/*
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'exports',
    'exports',
    true,
    52428800, -- 50MB limit
    ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for exports bucket
CREATE POLICY "Users can upload exports"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'exports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view own exports"
ON storage.objects FOR SELECT
USING (bucket_id = 'exports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own exports"
ON storage.objects FOR DELETE
USING (bucket_id = 'exports' AND auth.uid()::text = (storage.foldername(name))[1]);
*/
