import type { D1Database } from '@cloudflare/workers-types'

const LEGACY_DEFAULT_SYSTEM_PROMPT =
  'You are a helpful voice assistant. Keep responses concise and conversational, suitable for being spoken aloud. Avoid markdown, bullet points, or any formatting - respond in plain spoken sentences only.'

async function ensureAiConfigSchema(db: D1Database) {
  const info = await db.prepare(`PRAGMA table_info(ai_configs)`).all<any>()
  const columns = (info.results ?? []).map((row: any) => row.name)

  if (columns.length === 0) {
    console.log('ensureAiConfigSchema: ai_configs table missing, creating table')
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS ai_configs (
        id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), 
        user_id       TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        ai_name       TEXT NOT NULL DEFAULT 'Assistant',
        system_prompt TEXT NOT NULL DEFAULT '${LEGACY_DEFAULT_SYSTEM_PROMPT.replace(/'/g, "''")}',
        user_name     TEXT NOT NULL DEFAULT '',
        custom_instructions TEXT NOT NULL DEFAULT '',
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    ).run()
    return
  }

  if (!columns.includes('user_name')) {
    console.log('ensureAiConfigSchema: adding missing column user_name to ai_configs')
    await db.prepare(
      "ALTER TABLE ai_configs ADD COLUMN user_name TEXT NOT NULL DEFAULT ''"
    ).run()
  }

  if (!columns.includes('custom_instructions')) {
    console.log('ensureAiConfigSchema: adding missing column custom_instructions to ai_configs')
    await db.prepare(
      "ALTER TABLE ai_configs ADD COLUMN custom_instructions TEXT NOT NULL DEFAULT ''"
    ).run()
  }
}

export async function upsertUser(
  db: D1Database,
  { guest_id, email }: { guest_id: string; email?: string }
) {
  let user = await db.prepare('SELECT * FROM users WHERE guest_id = ?')
    .bind(guest_id).first<any>()

  if (!user) {
    if (email) {
      user = await db.prepare('SELECT * FROM users WHERE email = ?')
        .bind(email).first<any>()
      if (user) {
        await db.prepare('UPDATE users SET guest_id = ? WHERE id = ?')
          .bind(guest_id, user.id).run()
        return { ...user, is_new: false }
      }
    }

    const id = crypto.randomUUID()
    await db.prepare('INSERT INTO users (id, email, guest_id) VALUES (?, ?, ?)')
      .bind(id, email ?? null, guest_id).run()
    user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>()
    return { ...user, is_new: true }
  }

  if (email && !user.email) {
    await db.prepare('UPDATE users SET email = ? WHERE id = ?')
      .bind(email, user.id).run()
    user.email = email
  }

  return { ...user, is_new: false }
}

export async function getOrCreateSession(db: D1Database, userId: string) {
  let session = await db
    .prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at ASC LIMIT 1')
    .bind(userId).first<any>()

  if (!session) {
    const id = crypto.randomUUID()
    await db.prepare('INSERT INTO sessions (id, user_id) VALUES (?, ?)')
      .bind(id, userId).run()
    session = await db.prepare('SELECT * FROM sessions WHERE id = ?')
      .bind(id).first<any>()
  }

  return session
}

export async function loadHistory(db: D1Database, sessionId: string, limit = 20) {
  const rows = await db.prepare(
    `SELECT role, transcript FROM messages
     WHERE session_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).bind(sessionId, limit).all<any>()

  return (rows.results ?? []).reverse().map(r => ({
    role: r.role as 'user' | 'assistant',
    content: r.transcript,
  }))
}

export async function insertMessage(
  db: D1Database,
  sessionId: string,
  role: 'user' | 'assistant',
  transcript: string
) {
  const id = crypto.randomUUID()
  await db.prepare(
    'INSERT INTO messages (id, session_id, role, transcript) VALUES (?, ?, ?, ?)'
  ).bind(id, sessionId, role, transcript).run()
  return { id, role, transcript }
}

export async function getUserByGuestId(db: D1Database, guestId: string) {
  return db.prepare('SELECT * FROM users WHERE guest_id = ?')
    .bind(guestId).first<any>()
}

export async function getAiConfig(db: D1Database, userId: string) {
  await ensureAiConfigSchema(db)
  const config = await db.prepare('SELECT * FROM ai_configs WHERE user_id = ?')
    .bind(userId).first<any>()

  if (!config) {
    return {
      user_name: '',
      custom_instructions: '',
    }
  }

  const legacySystemPrompt = typeof config.system_prompt === 'string' ? config.system_prompt : ''
  const legacyCustomInstructions =
    legacySystemPrompt && !legacySystemPrompt.startsWith('You are a helpful voice assistant.')
      ? legacySystemPrompt
      : ''

  return {
    user_name: config.user_name ?? '',
    custom_instructions: config.custom_instructions ?? legacyCustomInstructions,
    ai_name: config.ai_name ?? 'Assistant',
    system_prompt: config.system_prompt ?? LEGACY_DEFAULT_SYSTEM_PROMPT,
  }
}

export async function upsertAiConfig(
  db: D1Database,
  userId: string,
  {
    user_name,
    custom_instructions,
  }: { user_name: string; custom_instructions: string }
) {
  await ensureAiConfigSchema(db)
  const existing = await db.prepare('SELECT id FROM ai_configs WHERE user_id = ?')
    .bind(userId).first<any>()

  if (existing) {
    await db.prepare(
      `UPDATE ai_configs
       SET user_name = ?, custom_instructions = ?, updated_at = datetime('now')
       WHERE user_id = ?`
    ).bind(user_name, custom_instructions, userId).run()
  } else {
    const id = crypto.randomUUID()
    await db.prepare(
      `INSERT INTO ai_configs
       (id, user_id, ai_name, system_prompt, user_name, custom_instructions)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, userId, 'Assistant', LEGACY_DEFAULT_SYSTEM_PROMPT, user_name, custom_instructions).run()
  }

  return { user_name, custom_instructions }
}
