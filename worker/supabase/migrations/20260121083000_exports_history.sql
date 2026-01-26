
-- Storage policies for exports bucket (if bucket exists)
-- Allow authenticated users to upload to their own folder
DO $$
BEGIN
    -- Policy for uploading
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' 
        AND policyname = 'Users can upload exports'
    ) THEN
        CREATE POLICY "Users can upload exports"
        ON storage.objects FOR INSERT
        WITH CHECK (
            bucket_id = 'exports' 
            AND auth.uid()::text = (string_to_array(name, '/'))[1]
        );
    END IF;
    
    -- Policy for viewing own files
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' 
        AND policyname = 'Users can view own exports'
    ) THEN
        CREATE POLICY "Users can view own exports"
        ON storage.objects FOR SELECT
        USING (
            bucket_id = 'exports' 
            AND auth.uid()::text = (string_to_array(name, '/'))[1]
        );
    END IF;
    
    -- Policy for deleting own files
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' 
        AND policyname = 'Users can delete own exports'
    ) THEN
        CREATE POLICY "Users can delete own exports"
        ON storage.objects FOR DELETE
        USING (
            bucket_id = 'exports' 
            AND auth.uid()::text = (string_to_array(name, '/'))[1]
        );
    END IF;
END $$;
