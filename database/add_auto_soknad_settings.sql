-- Add auto-søknad settings to user_settings
-- auto_soknad_enabled: toggle for automatic søknad generation during scanning
-- auto_soknad_min_score: minimum relevance score (0-100) to trigger auto-generation

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS auto_soknad_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_soknad_min_score INTEGER DEFAULT 50;
