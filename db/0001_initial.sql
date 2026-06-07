-- Users: email users and guests both get a row
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email       TEXT UNIQUE,           -- NULL for guests
  guest_id    TEXT UNIQUE NOT NULL,  -- localStorage UUID, always present
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessions: one per user (single ongoing conversation model)
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Messages: all turns stored here
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  transcript  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI config: user preferred name + custom instructions per user.
-- Legacy ai_name/system_prompt columns remain for compatibility.
CREATE TABLE IF NOT EXISTS ai_configs (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id       TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  ai_name       TEXT NOT NULL DEFAULT 'Assistant',
  system_prompt TEXT NOT NULL DEFAULT 'You are a helpful voice assistant. Keep responses concise and conversational, suitable for being spoken aloud. Avoid markdown, bullet points, or any formatting — respond in plain spoken sentences only.',
  user_name     TEXT NOT NULL DEFAULT '',
  custom_instructions TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
