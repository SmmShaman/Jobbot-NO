-- LinkedIn job scraping integration
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS linkedin_search_terms text[] DEFAULT '{}'::text[];
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS linkedin_scan_enabled boolean DEFAULT false;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS linkedin_location text DEFAULT 'Norway';
