ALTER TABLE ai_configs
ADD COLUMN user_name TEXT NOT NULL DEFAULT '';

ALTER TABLE ai_configs
ADD COLUMN custom_instructions TEXT NOT NULL DEFAULT '';
