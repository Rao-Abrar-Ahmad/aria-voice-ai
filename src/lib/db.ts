import type { D1Database } from '@cloudflare/workers-types'
import type { AiConfig, Message, Session, User } from '../types'

const DEFAULT_AI_CONFIG: AiConfig = {
  ai_name: 'Aria',
  system_prompt:
    'You are Aria, a warm and intelligent voice assistant. You speak in a natural, conversational tone - as if talking to a friend. Keep responses concise: 1-3 sentences unless more detail is genuinely needed. Never use markdown, bullet points, headers, or lists. Respond in plain flowing sentences only, since your words will be spoken aloud.',
}

type UserWithNewFlag = User & { is_new: boolean }

async function ensureV2Schema(db: D1Database) {
  const messageInfo = await db.prepare('PRAGMA table_info(messages)').all<any>()
  const messageColumns = (messageInfo.results ?? []).map((row: any) => row.name)

  if (messageColumns.includes('transcript') && !messageColumns.includes('content')) {
    await db.prepare("ALTER TABLE messages ADD COLUMN content TEXT NOT NULL DEFAULT ''").run()
    await db.prepare("UPDATE messages SET content = transcript WHERE content = ''").run()
  }

  const configInfo = await db.prepare('PRAGMA table_info(ai_configs)').all<any>()
  const configColumns = (configInfo.results ?? []).map((row: any) => row.name)

  if (configColumns.length === 0) {
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS ai_configs (
        id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id       TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        ai_name       TEXT NOT NULL DEFAULT 'Aria',
        system_prompt TEXT NOT NULL DEFAULT '${DEFAULT_AI_CONFIG.system_prompt.replace(/'/g, "''")}',
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ).run()
  }
}

export async function upsertUser(
  db: D1Database,
  { guest_id, email }: { guest_id: string; email?: string },
): Promise<UserWithNewFlag> {
  let user = await db.prepare('SELECT * FROM users WHERE guest_id = ?').bind(guest_id).first<User>()

  if (!user && email) {
    user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>()
    if (user) {
      await db.prepare('UPDATE users SET guest_id = ? WHERE id = ?').bind(guest_id, user.id).run()
      return { ...user, guest_id, is_new: false }
    }
  }

  if (!user) {
    const id = crypto.randomUUID()
    await db.prepare('INSERT INTO users (id, email, guest_id) VALUES (?, ?, ?)').bind(id, email ?? null, guest_id).run()
    const created = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>()
    if (!created) throw new Error('Failed to create user')
    return { ...created, is_new: true }
  }

  if (email && !user.email) {
    await db.prepare('UPDATE users SET email = ? WHERE id = ?').bind(email, user.id).run()
    user = { ...user, email }
  }

  return { ...user, is_new: false }
}

export async function getOrCreateSession(db: D1Database, userId: string): Promise<Session> {
  let session = await db
    .prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at ASC LIMIT 1')
    .bind(userId)
    .first<Session>()

  if (!session) {
    const id = crypto.randomUUID()
    await db.prepare('INSERT INTO sessions (id, user_id) VALUES (?, ?)').bind(id, userId).run()
    session = await db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first<Session>()
  }

  if (!session) throw new Error('Failed to create session')
  return session
}

export async function getSessionBySessionId(db: D1Database, sessionId: string) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').bind(sessionId).first<Session>()
}

export async function loadHistory(db: D1Database, sessionId: string, limit = 50): Promise<Message[]> {
  await ensureV2Schema(db)
  const rows = await db
    .prepare(
      `SELECT role, content FROM messages
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(sessionId, limit)
    .all<Message>()

  return (rows.results ?? []).reverse()
}

export async function insertMessage(db: D1Database, sessionId: string, role: Message['role'], content: string) {
  await ensureV2Schema(db)
  const id = crypto.randomUUID()
  await db
    .prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)')
    .bind(id, sessionId, role, content)
    .run()
  return { id, role, content }
}

export async function getAiConfig(db: D1Database, userId: string): Promise<AiConfig> {
  await ensureV2Schema(db)
  const config = await db
    .prepare('SELECT ai_name, system_prompt FROM ai_configs WHERE user_id = ?')
    .bind(userId)
    .first<AiConfig>()

  if (config) return config

  const id = crypto.randomUUID()
  await db
    .prepare('INSERT INTO ai_configs (id, user_id, ai_name, system_prompt) VALUES (?, ?, ?, ?)')
    .bind(id, userId, DEFAULT_AI_CONFIG.ai_name, DEFAULT_AI_CONFIG.system_prompt)
    .run()

  return DEFAULT_AI_CONFIG
}

export async function upsertAiConfig(db: D1Database, userId: string, config: AiConfig): Promise<AiConfig> {
  await ensureV2Schema(db)
  const normalized: AiConfig = {
    ai_name: config.ai_name.trim() || DEFAULT_AI_CONFIG.ai_name,
    system_prompt: config.system_prompt.trim() || DEFAULT_AI_CONFIG.system_prompt,
  }

  const existing = await db.prepare('SELECT id FROM ai_configs WHERE user_id = ?').bind(userId).first<{ id: string }>()
  if (existing) {
    await db
      .prepare("UPDATE ai_configs SET ai_name = ?, system_prompt = ?, updated_at = datetime('now') WHERE user_id = ?")
      .bind(normalized.ai_name, normalized.system_prompt, userId)
      .run()
  } else {
    const id = crypto.randomUUID()
    await db
      .prepare('INSERT INTO ai_configs (id, user_id, ai_name, system_prompt) VALUES (?, ?, ?, ?)')
      .bind(id, userId, normalized.ai_name, normalized.system_prompt)
      .run()
  }

  return normalized
}
