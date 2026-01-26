-- Storage policies for exports bucket

-- Allow authenticated users to upload to their own folder
CREATE POLICY "Users can upload exports"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'exports' 
    AND auth.uid()::text = (string_to_array(name, '/'))[1]
);

-- Allow users to view their own files
CREATE POLICY "Users can view own exports"
ON storage.objects FOR SELECT
USING (
    bucket_id = 'exports' 
    AND auth.uid()::text = (string_to_array(name, '/'))[1]
);

-- Allow users to delete their own files  
CREATE POLICY "Users can delete own exports"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'exports' 
    AND auth.uid()::text = (string_to_array(name, '/'))[1]
);
