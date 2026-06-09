-- Users table: covers both email users and guests
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email       TEXT UNIQUE,
  guest_id    TEXT UNIQUE NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessions table: one session per user (single ongoing conversation)
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Messages table: full conversation history
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI config: per-user AI name and system prompt
CREATE TABLE IF NOT EXISTS ai_configs (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id       TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  ai_name       TEXT NOT NULL DEFAULT 'Aria',
  system_prompt TEXT NOT NULL DEFAULT 'You are Aria, a warm and intelligent voice assistant. You speak in a natural, conversational tone - as if talking to a friend. Keep responses concise: 1-3 sentences unless more detail is genuinely needed. Never use markdown, bullet points, headers, or lists. Respond in plain flowing sentences only, since your words will be spoken aloud.',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_guest_id    ON users(guest_id);
CREATE INDEX IF NOT EXISTS idx_users_email       ON users(email);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id  ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_session  ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_time     ON messages(created_at);
