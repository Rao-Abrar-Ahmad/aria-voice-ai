# Voice AI — Complete Technical Specification v2

> **Purpose**: End-to-end build specification for an AI agent or developer. Fresh spec, supersedes v1.
> **Stack**: React + TypeScript + Vite · Tailwind CSS · shadcn/ui · AI Elements · react-speech-recognition · Cloudflare Workers + Hono · Durable Objects (WebSocket) · Workers AI (LLM + TTS) · D1 · Workers Assets
> **Architecture**: Sandwich voice pipeline — Browser Web Speech API (STT) → Cloudflare LLM → Cloudflare Deepgram Aura-1 (TTS)
> **Project model**: Single unified project — one `package.json`, one `wrangler.jsonc`, one deploy command

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Project Structure](#2-project-structure)
3. [Database Schema — D1](#3-database-schema--d1)
4. [Configuration — wrangler.jsonc](#4-configuration--wranlerjsonc)
5. [Backend — Cloudflare Worker + Durable Object](#5-backend--cloudflare-worker--durable-object)
6. [AI Pipeline](#6-ai-pipeline)
7. [WebSocket Message Protocol](#7-websocket-message-protocol)
8. [Frontend — React SPA](#8-frontend--react-spa)
9. [Phase Build Plan](#9-phase-build-plan)
10. [Environment & Local Dev](#10-environment--local-dev)
11. [Deployment](#11-deployment)
12. [ADRs — Architecture Decision Records](#12-adrs--architecture-decision-records)

---

## 1. System Overview

### What it does

A single-page voice AI application. The user clicks "Start Conversation", speaks naturally, and the AI responds in a synthesized voice. No text input. No push-to-talk. The browser's Web Speech API detects speech and silence automatically. Conversation history is persisted per user and survives page refresh.

### Sandwich architecture

```
[User speaks]
     │
     ▼
Web Speech API (browser-native STT)
  → interimTranscript  ─────────────────► UI: live streaming text (left panel)
  → finalTranscript fires on silence ──► WebSocket: send { type: "transcript", text }
     │
     ▼
Cloudflare Durable Object (WebSocket connection)
     │
     ├─ emit { type: "status", state: "thinking" } ──► UI: Persona switches to "thinking"
     │
     ▼
@cf/meta/llama-3.1-8b-instruct (LLM)
  → system prompt applied
  → full conversation history injected
  → streams response text
     │
     ├─ emit { type: "llm_chunk", text } ──► UI: AI response appended to transcript
     │
     ▼
@cf/deepgram/aura-1 (TTS)
  → converts LLM response to natural speech audio
     │
     ├─ emit { type: "status", state: "speaking" } ──► UI: Persona switches to "speaking"
     ├─ emit { type: "audio", data: base64, format: "mp3" } ──► Browser plays audio
     │
     ▼
Audio playback complete
     │
     ├─ emit { type: "status", state: "idle" } ──► UI: Persona returns to "idle"
     └─ mic resumes listening ──► ready for next turn
```

### UI layout states

**Before "Start Conversation" clicked**:
```
┌─────────────────────────────────────┐
│                                     │
│           [Persona orb]             │
│                                     │
│      [Start Conversation btn]       │
│                                     │
└─────────────────────────────────────┘
Single centered column (hero)
```

**After "Start Conversation" clicked (transcript hidden)**:
```
┌─────────────────────────────────────┐
│  [≡ transcript toggle]  [settings]  │
│                                     │
│           [Persona orb]             │
│         state-animated              │
│                                     │
│      [status label]  [End btn]      │
└─────────────────────────────────────┘
```

**After transcript toggle clicked**:
```
┌────────────────┬────────────────────┐
│  Conversation  │                    │
│  ──────────── │   [Persona orb]    │
│  You: Hello   │   state-animated   │
│  AI: Hi there │                    │
│  You: [live…] │  [status] [End]    │
└────────────────┴────────────────────┘
Two columns — transcript left, persona right
```

### Session persistence model

- Every visitor gets a stable `guest_id` UUID stored in `localStorage`
- On landing: popup asks for email or guest
- `POST /api/session` is called with `{ guest_id, email? }` — creates or resumes user + session
- Session cookie set by Worker (`Set-Cookie: session_id=...; HttpOnly; SameSite=Strict`)
- WebSocket connection authenticated by `session_id` cookie on upgrade
- On reconnect: D1 history loaded, conversation resumes seamlessly

---

## 2. Project Structure

```
voice-ai/
├── src/                                  # Cloudflare Worker (backend)
│   ├── index.ts                          # Hono entry — HTTP routes + WS upgrade
│   ├── routes/
│   │   ├── session.ts                    # POST /api/session (create/resume)
│   │   ├── history.ts                    # GET /api/history?session_id=
│   │   └── config.ts                     # GET|POST /api/config
│   ├── durable-objects/
│   │   └── VoiceSession.ts               # Durable Object — WS + AI pipeline
│   ├── lib/
│   │   ├── ai.ts                         # LLM + TTS pipeline helpers
│   │   ├── db.ts                         # D1 query helpers
│   │   └── session.ts                    # Session cookie helpers
│   └── types.ts                          # Shared Worker TypeScript types
│
├── client/                               # React SPA (Vite)
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                       # Root layout, state machine, WS orchestration
│       ├── components/
│       │   ├── LandingPopup.tsx          # Email / guest modal on first visit
│       │   ├── PersonaView.tsx           # AI Elements Persona + status label
│       │   ├── TranscriptPanel.tsx       # AI Elements Conversation + Message thread
│       │   ├── ConversationControls.tsx  # End button + transcript toggle + settings btn
│       │   └── SettingsPopup.tsx         # System prompt / AI name config
│       ├── hooks/
│       │   ├── useVoiceSession.ts        # Session init, localStorage UUID, cookie
│       │   ├── useSpeechRecognition.ts   # react-speech-recognition wrapper
│       │   ├── useVoiceWebSocket.ts      # WebSocket connection + message dispatch
│       │   └── useAudioPlayer.ts         # Plays base64 TTS audio, fires onEnd
│       ├── store/
│       │   └── voiceStore.ts             # Zustand: convState, messages, session, config
│       ├── lib/
│       │   └── api.ts                    # Typed fetch helpers for HTTP routes
│       └── types.ts                      # Shared frontend types
│
├── db/
│   └── 0001_initial.sql                  # D1 migration
│
├── dist/                                 # Vite build output → Workers Assets
│
├── wrangler.jsonc
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json                         # Worker TS config
├── tsconfig.client.json                  # Client TS config
└── package.json
```

---

## 3. Database Schema — D1

### `db/0001_initial.sql`

```sql
-- Users table: covers both email users and guests
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email       TEXT UNIQUE,                -- NULL for guests
  guest_id    TEXT UNIQUE NOT NULL,       -- localStorage UUID, stable across visits
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
  system_prompt TEXT NOT NULL DEFAULT 'You are Aria, a warm and intelligent voice assistant. You speak in a natural, conversational tone — as if talking to a friend. Keep responses concise: 1–3 sentences unless more detail is genuinely needed. Never use markdown, bullet points, headers, or lists. Respond in plain flowing sentences only, since your words will be spoken aloud.',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_guest_id    ON users(guest_id);
CREATE INDEX IF NOT EXISTS idx_users_email       ON users(email);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id  ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_session  ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_time     ON messages(created_at);
```

### Context window strategy

Load the last **30 messages** (15 turns) from D1 per turn. This gives the LLM meaningful context without overrunning the model's context window. Messages are ordered chronologically before injection.

---

## 4. Configuration — wrangler.jsonc

```jsonc
{
  // Worker name → deployed at voice-ai.YOUR-ACCOUNT.workers.dev
  "name": "voice-ai",

  // Hono Worker entry point
  "main": "src/index.ts",

  // Cloudflare recommended — enables Node.js built-ins (crypto, Buffer)
  "compatibility_date": "2024-09-23",
  "compatibility_flags": ["nodejs_compat"],

  // Workers Assets: Vite build output served as static files from CF CDN
  // not_found_handling ensures React Router / SPA works correctly
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application"
  },

  // Durable Object: one instance per user session, holds WebSocket + state
  "durable_objects": {
    "bindings": [
      {
        "name": "VOICE_SESSION",       // accessed as env.VOICE_SESSION in Worker
        "class_name": "VoiceSession"   // exported class name from src/durable-objects/VoiceSession.ts
      }
    ]
  },

  // Durable Object migration — required on first deploy and class rename
  "migrations": [
    {
      "tag": "v1",
      "new_classes": ["VoiceSession"]
    }
  ],

  // Cloudflare D1 — SQLite at the edge
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "voice-ai-db",
      "database_id": "REPLACE_WITH_YOUR_D1_DATABASE_ID"
    }
  ],

  // Cloudflare Workers AI — STT (unused), LLM, TTS
  "ai": {
    "binding": "AI"
  },

  // Non-secret environment variables
  "vars": {
    "ENVIRONMENT": "production",
    // Used for signing session cookies — OVERRIDE via wrangler secret in prod
    "COOKIE_SECRET": "change-me-in-production"
  },

  // Local dev overrides
  "env": {
    "development": {
      "vars": {
        "ENVIRONMENT": "development"
      }
    }
  }
}
```

> **Security note**: `COOKIE_SECRET` must be set as a Wrangler secret in production:
> ```bash
> npx wrangler secret put COOKIE_SECRET
> ```

---

## 5. Backend — Cloudflare Worker + Durable Object

### `src/types.ts`

```typescript
export type Env = {
  DB: D1Database
  AI: Ai
  ASSETS: Fetcher
  VOICE_SESSION: DurableObjectNamespace
  ENVIRONMENT: string
  COOKIE_SECRET: string
}

export type Message = {
  role: 'user' | 'assistant'
  content: string
}

export type AiConfig = {
  ai_name: string
  system_prompt: string
}

export type User = {
  id: string
  email: string | null
  guest_id: string
  created_at: string
}

export type Session = {
  id: string
  user_id: string
  created_at: string
}
```

### `src/index.ts` — Hono entry point

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getCookie, setCookie } from 'hono/cookie'
import { sessionRoute } from './routes/session'
import { historyRoute } from './routes/history'
import { configRoute } from './routes/config'
import type { Env } from './types'

// Re-export Durable Object class — required by Cloudflare
export { VoiceSession } from './durable-objects/VoiceSession'

const app = new Hono<{ Bindings: Env }>()

// CORS only needed for local dev (Vite :5173 ↔ Worker :8787)
// In production: same origin — no CORS needed
app.use('/api/*', cors({
  origin: ['http://localhost:5173'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  credentials: true,
}))

// HTTP API routes
app.route('/api/session', sessionRoute)
app.route('/api/history', historyRoute)
app.route('/api/config', configRoute)

// WebSocket upgrade route
// Client connects to /ws?session_id=SESSION_ID
// Worker authenticates via session cookie, then forwards to Durable Object
app.get('/ws', async (c) => {
  const sessionId = getCookie(c, 'session_id')
    ?? c.req.query('session_id')

  if (!sessionId) {
    return c.json({ error: 'No session' }, 401)
  }

  // Route to the Durable Object instance for this session
  const id = c.env.VOICE_SESSION.idFromName(sessionId)
  const stub = c.env.VOICE_SESSION.get(id)

  // Forward the WebSocket upgrade to the Durable Object
  return stub.fetch(c.req.raw)
})

export default app
```

### `src/routes/session.ts`

```typescript
import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { upsertUser, getOrCreateSession } from '../lib/db'
import type { Env } from '../types'

const app = new Hono<{ Bindings: Env }>()

// POST /api/session
// Body: { guest_id: string, email?: string }
// Returns: { session_id, user_id, ai_name, is_new_user }
// Sets: HttpOnly session_id cookie
app.post('/', async (c) => {
  const body = await c.req.json<{ guest_id: string; email?: string }>()

  if (!body.guest_id) {
    return c.json({ error: 'guest_id is required' }, 400)
  }

  const user = await upsertUser(c.env.DB, {
    guest_id: body.guest_id,
    email: body.email,
  })

  const session = await getOrCreateSession(c.env.DB, user.id)

  // Set persistent session cookie (7 days)
  setCookie(c, 'session_id', session.id, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: c.env.ENVIRONMENT === 'production',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  })

  return c.json({
    session_id: session.id,
    user_id: user.id,
    is_new_user: user.is_new,
  })
})

export { app as sessionRoute }
```

### `src/routes/history.ts`

```typescript
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { loadHistory } from '../lib/db'
import type { Env } from '../types'

const app = new Hono<{ Bindings: Env }>()

// GET /api/history
// Auth: session_id cookie
// Returns: { messages: [{ role, content }] }
// Used on app load to hydrate the transcript panel
app.get('/', async (c) => {
  const sessionId = getCookie(c, 'session_id')
  if (!sessionId) return c.json({ error: 'Unauthorized' }, 401)

  const limit = parseInt(c.req.query('limit') ?? '50', 10)
  const messages = await loadHistory(c.env.DB, sessionId, limit)

  return c.json({ messages })
})

export { app as historyRoute }
```

### `src/routes/config.ts`

```typescript
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { getSessionBySessionId, getAiConfig, upsertAiConfig } from '../lib/db'
import type { Env } from '../types'

const app = new Hono<{ Bindings: Env }>()

// GET /api/config
// Returns AI name and system prompt for the current user
app.get('/', async (c) => {
  const sessionId = getCookie(c, 'session_id')
  if (!sessionId) return c.json({ error: 'Unauthorized' }, 401)

  const session = await getSessionBySessionId(c.env.DB, sessionId)
  if (!session) return c.json({ error: 'Session not found' }, 404)

  const config = await getAiConfig(c.env.DB, session.user_id)
  return c.json(config)
})

// POST /api/config
// Body: { ai_name: string, system_prompt: string }
app.post('/', async (c) => {
  const sessionId = getCookie(c, 'session_id')
  if (!sessionId) return c.json({ error: 'Unauthorized' }, 401)

  const session = await getSessionBySessionId(c.env.DB, sessionId)
  if (!session) return c.json({ error: 'Session not found' }, 404)

  const { ai_name, system_prompt } = await c.req.json()
  const config = await upsertAiConfig(c.env.DB, session.user_id, { ai_name, system_prompt })

  return c.json(config)
})

export { app as configRoute }
```

### `src/lib/db.ts` — D1 query helpers

```typescript
import type { D1Database } from '@cloudflare/workers-types'
import type { Message, AiConfig, User, Session } from '../types'

// ── Users ──────────────────────────────────────────────────────────────────

export async function upsertUser(
  db: D1Database,
  { guest_id, email }: { guest_id: string; email?: string }
): Promise<User & { is_new: boolean }> {
  // 1. Try find by guest_id first (most common path)
  let user = await db
    .prepare('SELECT * FROM users WHERE guest_id = ?')
    .bind(guest_id)
    .first<User>()

  if (!user) {
    // 2. If email given, check if email user already exists (returning user, new device)
    if (email) {
      user = await db
        .prepare('SELECT * FROM users WHERE email = ?')
        .bind(email)
        .first<User>()

      if (user) {
        // Associate new guest_id with existing email user
        await db
          .prepare('UPDATE users SET guest_id = ? WHERE id = ?')
          .bind(guest_id, user.id)
          .run()
        return { ...user, is_new: false }
      }
    }

    // 3. Create brand new user
    const id = crypto.randomUUID()
    await db
      .prepare('INSERT INTO users (id, email, guest_id) VALUES (?, ?, ?)')
      .bind(id, email ?? null, guest_id)
      .run()
    user = await db
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(id)
      .first<User>()

    return { ...user!, is_new: true }
  }

  // Update email if now provided and was not set before
  if (email && !user.email) {
    await db
      .prepare('UPDATE users SET email = ? WHERE id = ?')
      .bind(email, user.id)
      .run()
    user = { ...user, email }
  }

  return { ...user, is_new: false }
}

// ── Sessions ───────────────────────────────────────────────────────────────

export async function getOrCreateSession(
  db: D1Database,
  userId: string
): Promise<Session> {
  // Single conversation model — always reuse the existing session
  let session = await db
    .prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at ASC LIMIT 1')
    .bind(userId)
    .first<Session>()

  if (!session) {
    const id = crypto.randomUUID()
    await db
      .prepare('INSERT INTO sessions (id, user_id) VALUES (?, ?)')
      .bind(id, userId)
      .run()
    session = await db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .bind(id)
      .first<Session>()
  }

  return session!
}

export async function getSessionBySessionId(
  db: D1Database,
  sessionId: string
): Promise<Session | null> {
  return db
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .bind(sessionId)
    .first<Session>()
}

// ── Messages ───────────────────────────────────────────────────────────────

export async function loadHistory(
  db: D1Database,
  sessionId: string,
  limit = 30
): Promise<Message[]> {
  const rows = await db
    .prepare(
      `SELECT role, content FROM messages
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .bind(sessionId, limit)
    .all<{ role: string; content: string }>()

  // Reverse DESC results to get chronological order
  return (rows.results ?? [])
    .reverse()
    .map(r => ({ role: r.role as 'user' | 'assistant', content: r.content }))
}

export async function insertMessage(
  db: D1Database,
  sessionId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  await db
    .prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), sessionId, role, content)
    .run()
}

// ── AI Config ─────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: AiConfig = {
  ai_name: 'Aria',
  system_prompt:
    'You are Aria, a warm and intelligent voice assistant. You speak in a natural, conversational tone — as if talking to a friend. Keep responses concise: 1–3 sentences unless more detail is genuinely needed. Never use markdown, bullet points, headers, or lists. Respond in plain flowing sentences only, since your words will be spoken aloud.',
}

export async function getAiConfig(
  db: D1Database,
  userId: string
): Promise<AiConfig> {
  const config = await db
    .prepare('SELECT ai_name, system_prompt FROM ai_configs WHERE user_id = ?')
    .bind(userId)
    .first<AiConfig>()

  return config ?? DEFAULT_CONFIG
}

export async function upsertAiConfig(
  db: D1Database,
  userId: string,
  { ai_name, system_prompt }: AiConfig
): Promise<AiConfig> {
  const existing = await db
    .prepare('SELECT id FROM ai_configs WHERE user_id = ?')
    .bind(userId)
    .first<{ id: string }>()

  if (existing) {
    await db
      .prepare(
        `UPDATE ai_configs
         SET ai_name = ?, system_prompt = ?, updated_at = datetime('now')
         WHERE user_id = ?`
      )
      .bind(ai_name, system_prompt, userId)
      .run()
  } else {
    await db
      .prepare(
        'INSERT INTO ai_configs (id, user_id, ai_name, system_prompt) VALUES (?, ?, ?, ?)'
      )
      .bind(crypto.randomUUID(), userId, ai_name, system_prompt)
      .run()
  }

  return { ai_name, system_prompt }
}
```

### `src/durable-objects/VoiceSession.ts` — Core DO

```typescript
import { DurableObject } from 'cloudflare:workers'
import { runLLM, runTTS } from '../lib/ai'
import { loadHistory, insertMessage, getSessionBySessionId, getAiConfig } from '../lib/db'
import type { Env, Message } from '../types'

// WebSocket message types (client → server)
type ClientMessage =
  | { type: 'transcript'; text: string }
  | { type: 'ping' }

// WebSocket message types (server → client)
type ServerMessage =
  | { type: 'status'; state: 'thinking' | 'speaking' | 'idle' | 'error' }
  | { type: 'llm_chunk'; text: string }
  | { type: 'audio'; data: string; format: 'mp3' }
  | { type: 'transcript_confirmed'; text: string }
  | { type: 'error'; message: string }
  | { type: 'pong' }

export class VoiceSession extends DurableObject<Env> {
  // In-memory state for the duration of a WS connection
  private sessionId: string | null = null
  private userId: string | null = null
  private processing = false

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Extract session_id from cookie or query param
    const cookieHeader = request.headers.get('Cookie') ?? ''
    const cookieMatch = cookieHeader.match(/session_id=([^;]+)/)
    const sessionId = cookieMatch?.[1] ?? url.searchParams.get('session_id')

    if (!sessionId) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Validate session exists in D1
    const session = await getSessionBySessionId(this.env.DB, sessionId)
    if (!session) {
      return new Response('Session not found', { status: 404 })
    }

    this.sessionId = session.id
    this.userId = session.user_id

    // WebSocket upgrade using Hibernation API
    const upgradeHeader = request.headers.get('Upgrade')
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // acceptWebSocket enables Hibernation — DO sleeps when no messages
    this.ctx.acceptWebSocket(server)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  // Called by Hibernation API when a message arrives
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return

    let parsed: ClientMessage
    try {
      parsed = JSON.parse(message)
    } catch {
      this.send(ws, { type: 'error', message: 'Invalid JSON' })
      return
    }

    if (parsed.type === 'ping') {
      this.send(ws, { type: 'pong' })
      return
    }

    if (parsed.type === 'transcript') {
      await this.handleTurn(ws, parsed.text)
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    // DO will hibernate automatically — no cleanup needed
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('WebSocket error:', error)
  }

  // ── Core turn handler ────────────────────────────────────────────────────

  private async handleTurn(ws: WebSocket, userText: string): Promise<void> {
    if (this.processing) {
      this.send(ws, { type: 'error', message: 'Already processing a turn' })
      return
    }

    if (!this.sessionId || !this.userId) {
      this.send(ws, { type: 'error', message: 'Session not initialized' })
      return
    }

    this.processing = true

    try {
      // 1. Confirm receipt of user transcript
      this.send(ws, { type: 'transcript_confirmed', text: userText })

      // 2. Save user message to D1
      await insertMessage(this.env.DB, this.sessionId, 'user', userText)

      // 3. Load conversation history + AI config
      const [history, aiConfig] = await Promise.all([
        loadHistory(this.env.DB, this.sessionId, 30),
        getAiConfig(this.env.DB, this.userId),
      ])

      // 4. Run LLM
      this.send(ws, { type: 'status', state: 'thinking' })

      const llmResponse = await runLLM({
        ai: this.env.AI,
        history,
        userText,
        systemPrompt: aiConfig.system_prompt,
        onChunk: (chunk) => {
          this.send(ws, { type: 'llm_chunk', text: chunk })
        },
      })

      // 5. Save AI response to D1
      await insertMessage(this.env.DB, this.sessionId, 'assistant', llmResponse)

      // 6. Run TTS
      this.send(ws, { type: 'status', state: 'speaking' })

      const audioBase64 = await runTTS({
        ai: this.env.AI,
        text: llmResponse,
      })

      this.send(ws, { type: 'audio', data: audioBase64, format: 'mp3' })

      // 7. Done — signal client to resume listening
      this.send(ws, { type: 'status', state: 'idle' })

    } catch (err) {
      console.error('Turn error:', err)
      this.send(ws, { type: 'error', message: 'Turn processing failed' })
      this.send(ws, { type: 'status', state: 'idle' })
    } finally {
      this.processing = false
    }
  }

  // ── Utility ──────────────────────────────────────────────────────────────

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message))
    } catch {
      // WebSocket may have closed — ignore
    }
  }
}
```

---

## 6. AI Pipeline

### `src/lib/ai.ts`

```typescript
import type { Ai } from '@cloudflare/workers-types'

// ── LLM — Llama 3.1 8B ──────────────────────────────────────────────────────

interface LLMOptions {
  ai: Ai
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  userText: string
  systemPrompt: string
  onChunk?: (text: string) => void
}

export async function runLLM({
  ai, history, userText, systemPrompt, onChunk,
}: LLMOptions): Promise<string> {
  const messages = [
    ...history,
    { role: 'user' as const, content: userText },
  ]

  // System prompt instructs model to be concise and conversational
  // Voice-optimized: no markdown, short sentences, spoken-word style
  const result = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      ...messages,
    ],
    max_tokens: 300,       // Keep responses short for TTS — long responses feel slow
    temperature: 0.75,     // Slightly creative but not erratic
    stream: false,         // Cloudflare Workers AI does not support true streaming LLM yet in DO context
  }) as { response: string }

  const text = result.response?.trim() ?? ''

  // Emit chunks for UI streaming (word-by-word simulation since CF LLM is non-streaming in DO)
  if (onChunk && text) {
    const words = text.split(' ')
    for (const word of words) {
      onChunk(word + ' ')
      // Small yield to allow WS message to flush (non-blocking)
      await new Promise(r => setTimeout(r, 0))
    }
  }

  return text
}

// ── TTS — Deepgram Aura-1 ────────────────────────────────────────────────────

interface TTSOptions {
  ai: Ai
  text: string
}

export async function runTTS({ ai, text }: TTSOptions): Promise<string> {
  // System prompt for Deepgram Aura-1: natural, warm speaking style
  // Aura-1 supports voice selection and speaking style hints
  const result = await ai.run('@cf/deepgram/aura-1', {
    text,
    // Voice options: "aura-asteria-en" (female, warm), "aura-orion-en" (male, confident)
    // "aura-luna-en" (female, soft), "aura-zeus-en" (male, deep)
    voice: 'aura-asteria-en',
  }) as { audio: string } // base64-encoded MP3

  return result.audio
}
```

### System prompts

**LLM system prompt (stored in D1 `ai_configs`, user-editable via settings)**:
```
You are Aria, a warm and intelligent voice assistant. You speak in a natural,
conversational tone — as if talking to a friend. Keep responses concise: 1–3
sentences unless more detail is genuinely needed. Never use markdown, bullet
points, headers, or lists. Respond in plain flowing sentences only, since your
words will be spoken aloud.
```

**TTS voice**: `aura-asteria-en` — warm, natural female voice from Deepgram. Can be changed to any Aura voice variant.

---

## 7. WebSocket Message Protocol

### Connection

```
Client: GET /ws (with Cookie: session_id=SESSION_ID or ?session_id=SESSION_ID)
        Upgrade: websocket

Server: 101 Switching Protocols
        → Connection handed to VoiceSession Durable Object
```

### Client → Server messages

```typescript
// User spoke — Web Speech API finalTranscript fired
{ type: "transcript", text: "What is the weather like today?" }

// Keepalive
{ type: "ping" }
```

### Server → Client messages

```typescript
// Confirm user transcript received (before LLM starts)
{ type: "transcript_confirmed", text: "What is the weather like today?" }

// Pipeline status updates
{ type: "status", state: "thinking" }   // LLM is processing
{ type: "status", state: "speaking" }   // TTS audio incoming
{ type: "status", state: "idle" }       // Turn complete, mic can resume

// LLM response streaming (word by word)
{ type: "llm_chunk", text: "The weather " }
{ type: "llm_chunk", text: "today is " }
{ type: "llm_chunk", text: "sunny and warm." }

// TTS audio — base64-encoded MP3
{ type: "audio", data: "SUQzBAAAAAAAI...", format: "mp3" }

// Error
{ type: "error", message: "Turn processing failed" }

// Keepalive response
{ type: "pong" }
```

### Frontend state machine driven by WS messages

```
idle
  │ → user clicks "Start Conversation"
  ▼
listening    (mic on, Web Speech API active)
  │ → finalTranscript fires, send { type: "transcript" }
  ▼
transcribing (WS message sent, awaiting server ack)
  │ → { type: "transcript_confirmed" } received
  │ → { type: "status", state: "thinking" } received
  ▼
thinking     (Persona shows "thinking" animation)
  │ → { type: "llm_chunk" } messages stream in → transcript panel updates
  │ → { type: "status", state: "speaking" } received
  ▼
speaking     (Persona shows "speaking" animation)
  │ → { type: "audio" } received → audio plays
  │ → { type: "status", state: "idle" } received
  ▼
listening    (mic resumes automatically — loop)
  │ → user clicks "End"
  ▼
idle
```

---

## 8. Frontend — React SPA

### `client/src/store/voiceStore.ts` — Zustand global state

```typescript
import { create } from 'zustand'

export type ConvState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'

export type TranscriptMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  isStreaming?: boolean  // true while llm_chunk messages are still arriving
}

type VoiceStore = {
  // Session
  sessionId: string | null
  userId: string | null
  guestId: string
  setSession: (sessionId: string, userId: string) => void

  // Conversation state
  convState: ConvState
  setConvState: (state: ConvState) => void

  // Messages
  messages: TranscriptMessage[]
  addMessage: (msg: TranscriptMessage) => void
  appendChunkToLast: (text: string) => void
  setMessages: (msgs: TranscriptMessage[]) => void

  // UI
  showTranscript: boolean
  toggleTranscript: () => void
  conversationStarted: boolean
  setConversationStarted: (v: boolean) => void

  // AI config
  aiName: string
  systemPrompt: string
  setAiConfig: (name: string, prompt: string) => void

  // Interim transcript (live typing effect from Web Speech API)
  interimText: string
  setInterimText: (text: string) => void
}

export const useVoiceStore = create<VoiceStore>((set) => ({
  sessionId: null,
  userId: null,
  guestId: localStorage.getItem('voice_ai_guest_id') ?? (() => {
    const id = crypto.randomUUID()
    localStorage.setItem('voice_ai_guest_id', id)
    return id
  })(),
  setSession: (sessionId, userId) => set({ sessionId, userId }),

  convState: 'idle',
  setConvState: (convState) => set({ convState }),

  messages: [],
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  appendChunkToLast: (text) => set((s) => {
    const msgs = [...s.messages]
    const last = msgs[msgs.length - 1]
    if (last && last.role === 'assistant') {
      msgs[msgs.length - 1] = { ...last, text: last.text + text }
    }
    return { messages: msgs }
  }),
  setMessages: (messages) => set({ messages }),

  showTranscript: false,
  toggleTranscript: () => set((s) => ({ showTranscript: !s.showTranscript })),
  conversationStarted: false,
  setConversationStarted: (conversationStarted) => set({ conversationStarted }),

  aiName: 'Aria',
  systemPrompt: '',
  setAiConfig: (aiName, systemPrompt) => set({ aiName, systemPrompt }),

  interimText: '',
  setInterimText: (interimText) => set({ interimText }),
}))
```

### `client/src/hooks/useVoiceSession.ts`

```typescript
import { useEffect } from 'react'
import { useVoiceStore } from '../store/voiceStore'

export function useVoiceSession() {
  const { guestId, setSession, setAiConfig } = useVoiceStore()

  const initSession = async (email?: string) => {
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',  // send/receive cookies
      body: JSON.stringify({ guest_id: guestId, email }),
    })

    if (!res.ok) throw new Error('Session init failed')

    const { session_id, user_id } = await res.json()
    setSession(session_id, user_id)

    // Load AI config
    const cfgRes = await fetch('/api/config', { credentials: 'include' })
    if (cfgRes.ok) {
      const { ai_name, system_prompt } = await cfgRes.json()
      setAiConfig(ai_name, system_prompt)
    }

    // Load conversation history
    const histRes = await fetch('/api/history?limit=50', { credentials: 'include' })
    if (histRes.ok) {
      const { messages } = await histRes.json()
      useVoiceStore.getState().setMessages(
        messages.map((m: any) => ({
          id: crypto.randomUUID(),
          role: m.role,
          text: m.content,
        }))
      )
    }

    return { session_id, user_id }
  }

  return { initSession, guestId }
}
```

### `client/src/hooks/useVoiceWebSocket.ts`

```typescript
import { useEffect, useRef, useCallback } from 'react'
import { useVoiceStore } from '../store/voiceStore'

export function useVoiceWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const { sessionId, setConvState, addMessage, appendChunkToLast } = useVoiceStore()
  const isConnectedRef = useRef(false)

  const connect = useCallback(() => {
    if (!sessionId || isConnectedRef.current) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const ws = new WebSocket(`${protocol}//${host}/ws?session_id=${sessionId}`)

    ws.onopen = () => {
      isConnectedRef.current = true
      // Keepalive ping every 30s to prevent idle disconnection
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }))
        } else {
          clearInterval(pingInterval)
        }
      }, 30_000)
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)

      switch (msg.type) {
        case 'transcript_confirmed':
          // Add user message to transcript panel
          addMessage({
            id: crypto.randomUUID(),
            role: 'user',
            text: msg.text,
          })
          break

        case 'status':
          setConvState(msg.state)
          if (msg.state === 'thinking') {
            // Add empty assistant message — chunks will fill it in
            addMessage({
              id: crypto.randomUUID(),
              role: 'assistant',
              text: '',
              isStreaming: true,
            })
          }
          if (msg.state === 'idle') {
            // Mark last assistant message as no longer streaming
            const msgs = useVoiceStore.getState().messages
            const last = msgs[msgs.length - 1]
            if (last?.isStreaming) {
              useVoiceStore.getState().setMessages(
                msgs.map((m, i) => i === msgs.length - 1 ? { ...m, isStreaming: false } : m)
              )
            }
          }
          break

        case 'llm_chunk':
          appendChunkToLast(msg.text)
          break

        case 'audio':
          // Handled by useAudioPlayer — dispatch custom event
          window.dispatchEvent(new CustomEvent('voice-ai-audio', {
            detail: { data: msg.data, format: msg.format }
          }))
          break

        case 'error':
          console.error('Server error:', msg.message)
          setConvState('idle')
          break
      }
    }

    ws.onclose = () => {
      isConnectedRef.current = false
      // Reconnect after 2s if session still active
      setTimeout(() => {
        if (useVoiceStore.getState().sessionId) connect()
      }, 2000)
    }

    ws.onerror = (err) => {
      console.error('WebSocket error:', err)
    }

    wsRef.current = ws
  }, [sessionId])

  const sendTranscript = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'transcript', text }))
      setConvState('transcribing')
    }
  }, [])

  const disconnect = useCallback(() => {
    wsRef.current?.close()
    isConnectedRef.current = false
  }, [])

  useEffect(() => {
    if (sessionId) connect()
    return () => disconnect()
  }, [sessionId])

  return { sendTranscript, connect, disconnect }
}
```

### `client/src/hooks/useSpeechRecognition.ts`

```typescript
import { useEffect, useRef, useCallback } from 'react'
import SpeechRecognition, { useSpeechRecognition as useRSR } from 'react-speech-recognition'
import { useVoiceStore } from '../store/voiceStore'

interface Options {
  onFinalTranscript: (text: string) => void
  enabled: boolean  // false while AI is speaking — prevents feedback loop
}

export function useSpeechInput({ onFinalTranscript, enabled }: Options) {
  const { setInterimText, setConvState } = useVoiceStore()

  const {
    transcript,
    interimTranscript,
    finalTranscript,
    listening,
    browserSupportsSpeechRecognition,
    resetTranscript,
  } = useRSR()

  // Fire when finalTranscript updates (user paused naturally)
  useEffect(() => {
    if (finalTranscript && enabled) {
      const text = finalTranscript.trim()
      if (text.length > 0) {
        resetTranscript()
        setInterimText('')
        onFinalTranscript(text)
      }
    }
  }, [finalTranscript])

  // Stream interim transcript to UI
  useEffect(() => {
    setInterimText(interimTranscript)
  }, [interimTranscript])

  const startListening = useCallback(() => {
    if (!browserSupportsSpeechRecognition) {
      alert('Your browser does not support speech recognition. Please use Chrome or Edge.')
      return
    }
    SpeechRecognition.startListening({
      continuous: true,      // keep listening between phrases
      language: 'en-US',
      interimResults: true,  // stream interim transcript to UI
    })
    setConvState('listening')
  }, [browserSupportsSpeechRecognition])

  const stopListening = useCallback(() => {
    SpeechRecognition.stopListening()
    resetTranscript()
    setInterimText('')
  }, [])

  return {
    startListening,
    stopListening,
    listening,
    isSupported: browserSupportsSpeechRecognition,
    interimTranscript,
  }
}
```

### `client/src/hooks/useAudioPlayer.ts`

```typescript
import { useEffect, useRef, useCallback } from 'react'
import { useVoiceStore } from '../store/voiceStore'

interface Options {
  onPlaybackEnd: () => void  // called when TTS audio finishes → resume mic
}

export function useAudioPlayer({ onPlaybackEnd }: Options) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const handleAudio = (event: Event) => {
      const { data, format } = (event as CustomEvent).detail

      // Decode base64 → Blob → Object URL
      const binary = atob(data)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      const blob = new Blob([bytes], { type: `audio/${format}` })
      const url = URL.createObjectURL(blob)

      // Play
      if (audioRef.current) {
        audioRef.current.pause()
        URL.revokeObjectURL(audioRef.current.src)
      }

      const audio = new Audio(url)
      audioRef.current = audio

      audio.onended = () => {
        URL.revokeObjectURL(url)
        onPlaybackEnd()
      }

      audio.onerror = () => {
        URL.revokeObjectURL(url)
        onPlaybackEnd()
      }

      audio.play().catch(console.error)
    }

    window.addEventListener('voice-ai-audio', handleAudio)
    return () => window.removeEventListener('voice-ai-audio', handleAudio)
  }, [onPlaybackEnd])

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
  }, [])

  return { stopAudio }
}
```

### `client/src/components/LandingPopup.tsx`

```tsx
import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Props {
  open: boolean
  onContinue: (email?: string) => Promise<void>
}

export function LandingPopup({ open, onContinue }: Props) {
  const [mode, setMode] = useState<'choice' | 'email'>('choice')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  const handleContinue = async (emailValue?: string) => {
    setLoading(true)
    try {
      await onContinue(emailValue)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-sm" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-center text-2xl font-semibold">
            Welcome
          </DialogTitle>
          <DialogDescription className="text-center text-sm text-muted-foreground">
            Start a voice conversation with your AI assistant
          </DialogDescription>
        </DialogHeader>

        {mode === 'choice' && (
          <div className="flex flex-col gap-3 pt-2">
            <Button
              onClick={() => setMode('email')}
              className="w-full"
              size="lg"
            >
              Continue with email
            </Button>
            <Button
              variant="outline"
              onClick={() => handleContinue(undefined)}
              disabled={loading}
              className="w-full"
              size="lg"
            >
              {loading ? 'Starting...' : 'Continue as guest'}
            </Button>
          </div>
        )}

        {mode === 'email' && (
          <div className="flex flex-col gap-3 pt-2">
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && email) handleContinue(email)
              }}
              autoFocus
            />
            <Button
              onClick={() => handleContinue(email)}
              disabled={!email || loading}
              className="w-full"
              size="lg"
            >
              {loading ? 'Starting...' : 'Start conversation'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setMode('choice')}
              className="w-full text-sm"
            >
              ← Back
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

### `client/src/components/PersonaView.tsx`

```tsx
import { Persona } from '@/components/ai-elements/persona'
import { useVoiceStore, type ConvState } from '../store/voiceStore'

// Map our conversation states to AI Elements Persona states
const PERSONA_STATE_MAP: Record<ConvState, 'idle' | 'listening' | 'thinking' | 'speaking' | 'asleep'> = {
  idle: 'asleep',
  listening: 'listening',
  transcribing: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
}

const STATUS_LABELS: Record<ConvState, string> = {
  idle: '',
  listening: 'Listening...',
  transcribing: 'Got it...',
  thinking: 'Thinking...',
  speaking: 'Speaking...',
}

interface Props {
  aiName: string
}

export function PersonaView({ aiName }: Props) {
  const { convState, interimText } = useVoiceStore()
  const personaState = PERSONA_STATE_MAP[convState]
  const statusLabel = STATUS_LABELS[convState]

  return (
    <div className="flex flex-col items-center gap-6">
      <Persona
        state={personaState}
        variant="obsidian"
        className="w-48 h-48"
      />

      <div className="text-center min-h-[2rem]">
        {convState === 'listening' && interimText ? (
          <p className="text-sm text-muted-foreground italic max-w-xs text-center">
            "{interimText}"
          </p>
        ) : statusLabel ? (
          <p className="text-sm text-muted-foreground">{statusLabel}</p>
        ) : (
          <p className="text-sm font-medium text-foreground">{aiName}</p>
        )}
      </div>
    </div>
  )
}
```

### `client/src/components/TranscriptPanel.tsx`

```tsx
import { useEffect, useRef } from 'react'
import {
  Conversation,
  ConversationContent,
} from '@/components/ai-elements/conversation'
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { useVoiceStore } from '../store/voiceStore'

interface Props {
  aiName: string
}

export function TranscriptPanel({ aiName }: Props) {
  const { messages } = useVoiceStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-border text-sm font-medium text-muted-foreground shrink-0">
        Conversation
      </div>

      <div className="flex-1 overflow-y-auto">
        <Conversation>
          <ConversationContent>
            {messages.map((msg) => (
              <Message key={msg.id} from={msg.role === 'user' ? 'user' : 'assistant'}>
                <MessageContent>
                  {msg.isStreaming && !msg.text ? (
                    <Shimmer className="h-4 w-32" />
                  ) : (
                    <MessageResponse>
                      {msg.text}
                      {msg.isStreaming && (
                        <span className="inline-block w-1 h-4 ml-0.5 bg-current animate-pulse" />
                      )}
                    </MessageResponse>
                  )}
                </MessageContent>
              </Message>
            ))}
          </ConversationContent>
        </Conversation>
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
```

### `client/src/components/ConversationControls.tsx`

```tsx
import { PanelLeft, Settings, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useVoiceStore } from '../store/voiceStore'

interface Props {
  onEnd: () => void
  onSettingsOpen: () => void
}

export function ConversationControls({ onEnd, onSettingsOpen }: Props) {
  const { convState, showTranscript, toggleTranscript } = useVoiceStore()
  const isActive = convState !== 'idle'

  return (
    <div className="flex items-center justify-between w-full max-w-sm">
      {/* Transcript toggle */}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleTranscript}
        className={showTranscript ? 'text-primary' : 'text-muted-foreground'}
        title="Toggle transcript"
      >
        <PanelLeft size={18} />
      </Button>

      {/* End conversation button */}
      <Button
        variant="destructive"
        size="sm"
        onClick={onEnd}
        className="flex items-center gap-2"
      >
        <Square size={14} fill="currentColor" />
        End
      </Button>

      {/* Settings */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onSettingsOpen}
        className="text-muted-foreground"
        title="Settings"
      >
        <Settings size={18} />
      </Button>
    </div>
  )
}
```

### `client/src/App.tsx` — Root orchestration

```tsx
import { useState, useCallback } from 'react'
import { LandingPopup } from './components/LandingPopup'
import { PersonaView } from './components/PersonaView'
import { TranscriptPanel } from './components/TranscriptPanel'
import { ConversationControls } from './components/ConversationControls'
import { SettingsPopup } from './components/SettingsPopup'
import { Button } from '@/components/ui/button'
import { useVoiceSession } from './hooks/useVoiceSession'
import { useVoiceWebSocket } from './hooks/useVoiceWebSocket'
import { useSpeechInput } from './hooks/useSpeechRecognition'
import { useAudioPlayer } from './hooks/useAudioPlayer'
import { useVoiceStore } from './store/voiceStore'
import { Mic } from 'lucide-react'

export default function App() {
  const [showLanding, setShowLanding] = useState(true)
  const [showSettings, setShowSettings] = useState(false)

  const {
    convState,
    setConvState,
    conversationStarted,
    setConversationStarted,
    showTranscript,
    aiName,
  } = useVoiceStore()

  const { initSession } = useVoiceSession()
  const { sendTranscript } = useVoiceWebSocket()

  // Resume mic when TTS playback ends
  const handleAudioEnd = useCallback(() => {
    setConvState('listening')
    startListening()
  }, [])

  useAudioPlayer({ onPlaybackEnd: handleAudioEnd })

  // Speech recognition — disabled while AI is speaking to prevent feedback loop
  const micEnabled = convState === 'listening' || convState === 'transcribing'

  const { startListening, stopListening } = useSpeechInput({
    enabled: micEnabled,
    onFinalTranscript: (text) => {
      sendTranscript(text)
    },
  })

  const handleLandingContinue = async (email?: string) => {
    await initSession(email)
    setShowLanding(false)
  }

  const handleStartConversation = () => {
    setConversationStarted(true)
    setConvState('listening')
    startListening()
  }

  const handleEndConversation = () => {
    stopListening()
    setConvState('idle')
    setConversationStarted(false)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Landing popup — shown until session is initialised */}
      <LandingPopup open={showLanding} onContinue={handleLandingContinue} />

      {/* Settings popup */}
      <SettingsPopup
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />

      {!conversationStarted ? (
        // ── Hero state — single centered column ──────────────────────────
        <div className="flex flex-col items-center justify-center min-h-screen gap-8 px-4">
          <PersonaView aiName={aiName} />
          <Button
            size="lg"
            onClick={handleStartConversation}
            disabled={showLanding}
            className="flex items-center gap-2 px-8 py-6 text-base rounded-full"
          >
            <Mic size={20} />
            Start Conversation
          </Button>
        </div>

      ) : (
        // ── Active conversation — split or single column ──────────────────
        <div className={`flex h-screen ${showTranscript ? 'flex-row' : 'flex-col'}`}>

          {/* Transcript panel — left column when toggled on */}
          {showTranscript && (
            <div className="w-80 border-r border-border flex flex-col shrink-0">
              <TranscriptPanel aiName={aiName} />
            </div>
          )}

          {/* Persona column — always visible */}
          <div className="flex-1 flex flex-col items-center justify-between py-12 px-6">
            <div /> {/* spacer */}

            <PersonaView aiName={aiName} />

            <ConversationControls
              onEnd={handleEndConversation}
              onSettingsOpen={() => setShowSettings(true)}
            />
          </div>

        </div>
      )}
    </div>
  )
}
```

### AI Elements installation commands

```bash
# Install Persona component
npx ai-elements@latest add persona

# Install Conversation + Message components
npx ai-elements@latest add conversation
npx ai-elements@latest add message

# Install Shimmer (loading state)
npx ai-elements@latest add shimmer
```

> **Important**: AI Elements components install into `src/components/ai-elements/` and become part of your codebase. They are not imported from `node_modules` — they are copy-pasted into your project by the CLI. This means full customisation is available, but you must install shadcn/ui first.

---

## 9. Phase Build Plan

### Phase 1A — Project scaffold

**Goal**: Project boots, Vite and Wrangler run concurrently in local dev.

Tasks:
- [ ] `npm create cloudflare@latest voice-ai -- --type worker`
- [ ] Delete generated `wrangler.toml`, create `wrangler.jsonc` per Section 4
- [ ] Install all dependencies (see Section 10)
- [ ] Set up `vite.config.ts` with `root: 'client'` and `outDir: '../dist'`
- [ ] Set up `tsconfig.json` (Worker) and `tsconfig.client.json` (React)
- [ ] Initialise shadcn/ui: `npx shadcn@latest init`
- [ ] Add npm scripts: `dev`, `dev:worker`, `dev:client`, `build`, `deploy`
- [ ] Verify `npm run dev` starts both Vite (:5173) and Wrangler (:8787)

---

### Phase 1B — D1 database

**Goal**: D1 created, migrated, and query helpers working.

Tasks:
- [ ] `npx wrangler d1 create voice-ai-db`
- [ ] Paste `database_id` into `wrangler.jsonc`
- [ ] Create `db/0001_initial.sql` (full schema from Section 3)
- [ ] `npm run db:migrate:local` — apply migration to local D1
- [ ] `npm run db:migrate:remote` — apply migration to remote D1
- [ ] Implement `src/lib/db.ts` (all helpers from Section 5)
- [ ] Test `upsertUser` and `getOrCreateSession` with a quick test script

---

### Phase 1C — HTTP API routes

**Goal**: Session, history, and config endpoints fully working.

Tasks:
- [ ] Implement `src/types.ts`
- [ ] Implement `src/lib/session.ts` (cookie helpers)
- [ ] Implement `src/routes/session.ts`
- [ ] Implement `src/routes/history.ts`
- [ ] Implement `src/routes/config.ts`
- [ ] Wire up Hono in `src/index.ts` (without DO export yet)
- [ ] Test all endpoints via curl:

```bash
# Create guest session
curl -c cookies.txt -X POST http://localhost:8787/api/session \
  -H "Content-Type: application/json" \
  -d '{"guest_id":"test-uuid-001"}'
# Expected: { session_id, user_id, is_new_user: true }

# Create email session
curl -c cookies.txt -X POST http://localhost:8787/api/session \
  -H "Content-Type: application/json" \
  -d '{"guest_id":"test-uuid-001","email":"test@example.com"}'
# Expected: { session_id, user_id, is_new_user: false }

# Get config (uses cookie)
curl -b cookies.txt http://localhost:8787/api/config
# Expected: { ai_name: "Aria", system_prompt: "..." }

# Get history
curl -b cookies.txt "http://localhost:8787/api/history?limit=50"
# Expected: { messages: [] }
```

---

### Phase 1D — Durable Object + WebSocket

**Goal**: WebSocket connects, turns process end-to-end via AI pipeline.

Tasks:
- [ ] Implement `src/lib/ai.ts` (`runLLM` and `runTTS`)
- [ ] Implement `src/durable-objects/VoiceSession.ts`
- [ ] Add DO export and `/ws` upgrade route to `src/index.ts`
- [ ] Add DO migration to `wrangler.jsonc`
- [ ] Test WebSocket connection:

```bash
# Using websocat (npm i -g websocat)
websocat "ws://localhost:8787/ws?session_id=SESSION_ID_FROM_STEP_1C"
# Type: {"type":"ping"}
# Expected: {"type":"pong"}
# Type: {"type":"transcript","text":"Hello, how are you?"}
# Expected: stream of status/llm_chunk/audio messages
```

- [ ] Verify messages are saved to D1 after each turn
- [ ] Verify base64 audio from Deepgram Aura-1 decodes to audible MP3

---

### Phase 2A — Frontend skeleton

**Goal**: React app loads, landing popup works, session initialises.

Tasks:
- [ ] Create `client/index.html`, `client/src/main.tsx`
- [ ] Set up Tailwind in `client/src`
- [ ] Install AI Elements components (see installation commands in Section 8)
- [ ] Implement `voiceStore.ts` (Zustand)
- [ ] Implement `useVoiceSession.ts` hook
- [ ] Implement `LandingPopup.tsx` component
- [ ] Implement minimal `App.tsx` — shows popup, calls `initSession`, dismisses
- [ ] Verify: guest UUID stable in localStorage across page refreshes
- [ ] Verify: session cookie set on session init, survives page refresh

---

### Phase 2B — WebSocket + speech recognition

**Goal**: User speaks → AI responds via full pipeline.

Tasks:
- [ ] Implement `useVoiceWebSocket.ts` hook
- [ ] Implement `useSpeechRecognition.ts` hook
- [ ] Implement `useAudioPlayer.ts` hook
- [ ] Wire up full conversation loop in `App.tsx`
- [ ] Test: speak a sentence → see `thinking` → hear AI audio response
- [ ] Verify: mic stops while AI is speaking (feedback loop prevention)
- [ ] Verify: mic resumes automatically after audio playback ends
- [ ] Verify: `finalTranscript` triggers send (no manual button needed)

---

### Phase 2C — Persona + UI states

**Goal**: Persona animation responds correctly to all conversation states.

Tasks:
- [ ] Implement `PersonaView.tsx` using AI Elements `Persona` component
- [ ] Wire `convState` from Zustand → `PERSONA_STATE_MAP` → Persona `state` prop
- [ ] Verify all 5 states animate: asleep (idle) → listening → thinking → speaking → asleep
- [ ] Verify interim transcript text appears below Persona while user speaks
- [ ] Verify status labels update per state

---

### Phase 3A — Transcript panel

**Goal**: Transcript split-view works with live streaming and history.

Tasks:
- [ ] Implement `TranscriptPanel.tsx` using AI Elements `Conversation` + `Message`
- [ ] Verify: `PanelLeft` toggle switches layout between single/two-column
- [ ] Verify: user messages appear on `transcript_confirmed` WS event
- [ ] Verify: AI messages stream in word-by-word from `llm_chunk` events
- [ ] Verify: Shimmer shown while AI message is empty but streaming
- [ ] Verify: history from D1 populates panel on session resume
- [ ] Verify: auto-scroll to bottom on new message

---

### Phase 3B — Controls, settings, and polish

Tasks:
- [ ] Implement `ConversationControls.tsx`
- [ ] Implement `SettingsPopup.tsx` (AI name + system prompt form, POST /api/config)
- [ ] Hero → conversation layout transition (smooth, no flicker)
- [ ] Handle microphone permission denied gracefully (inline error, not alert)
- [ ] Handle WebSocket disconnection gracefully (auto-reconnect, status indicator)
- [ ] Handle unsupported browser (non-Chrome) — show clear message
- [ ] Dark mode support (Tailwind `dark:` throughout)
- [ ] Mobile: single column always (hide transcript toggle on mobile, `sm:` breakpoint)
- [ ] Add `<meta>` tags in `client/index.html` (title, description, viewport)
- [ ] Empty state in transcript panel ("Start talking to begin...")

---

## 10. Environment & Local Dev

### `package.json`

```json
{
  "name": "voice-ai",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev:worker": "wrangler dev",
    "dev:client": "vite",
    "dev": "concurrently \"npm run dev:worker\" \"npm run dev:client\"",
    "build": "vite build",
    "deploy": "npm run build && wrangler deploy",
    "db:migrate:local": "wrangler d1 execute voice-ai-db --local --file=db/0001_initial.sql",
    "db:migrate:remote": "wrangler d1 execute voice-ai-db --remote --file=db/0001_initial.sql"
  },
  "dependencies": {
    "hono": "^4.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "react-speech-recognition": "^3.10.0",
    "zustand": "^4.0.0",
    "lucide-react": "^0.400.0"
  },
  "devDependencies": {
    "wrangler": "^3.0.0",
    "@cloudflare/workers-types": "^4.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "tailwindcss": "^3.0.0",
    "autoprefixer": "^10.0.0",
    "postcss": "^8.0.0",
    "concurrently": "^8.0.0",
    "@types/react": "^18.0.0",
    "@types/react-dom": "^18.0.0",
    "@types/react-speech-recognition": "^3.9.0"
  }
}
```

### `vite.config.ts`

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  root: 'client',
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'client/src') }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Forward API and WebSocket calls to Wrangler dev server in local dev
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true,           // WebSocket proxy
        changeOrigin: true,
      },
    },
  },
})
```

### `tsconfig.json` (Worker)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["client", "dist", "node_modules"]
}
```

### `tsconfig.client.json` (React SPA)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "types": [],
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": { "@/*": ["client/src/*"] }
  },
  "include": ["client/src/**/*"],
  "exclude": ["src", "node_modules"]
}
```

---

## 11. Deployment

```bash
# ── One-time setup ─────────────────────────────────────────────────────────

# 1. Create D1 database
npx wrangler d1 create voice-ai-db
# → Copy database_id into wrangler.jsonc

# 2. Run D1 migration on remote
npm run db:migrate:remote

# 3. Set production secrets
npx wrangler secret put COOKIE_SECRET
# → Enter a long random string (32+ chars)

# ── Every deploy ───────────────────────────────────────────────────────────

# 4. Build SPA + deploy Worker + Assets in one command
npm run deploy
# Internally: vite build → dist/ → wrangler deploy

# ── Result ─────────────────────────────────────────────────────────────────
# https://voice-ai.YOUR-ACCOUNT.workers.dev
# GET  /        → React SPA (Workers Assets CDN)
# POST /api/*   → Hono HTTP routes
# GET  /ws      → WebSocket upgrade → Durable Object
# GET  /*       → index.html (SPA fallback)
```

### Custom domain (optional)

Cloudflare dashboard → Workers & Pages → voice-ai → Settings → Domains & Routes → Add Custom Domain.

---

## 12. ADRs — Architecture Decision Records

### ADR-001: Web Speech API (browser STT) over Cloudflare Whisper

**Status**: Accepted

**Context**: STT can happen in the browser via Web Speech API or server-side via Cloudflare Whisper (`@cf/openai/whisper-large-v3-turbo`). Whisper requires sending an audio blob to the Worker (~100-500KB per turn) and then waiting for GPU inference (~1-3 seconds). Web Speech API transcribes speech locally in real-time, using the browser's built-in engine (Google's engine in Chrome), and fires `finalTranscript` the moment a natural pause is detected.

**Decision**: Use Web Speech API via `react-speech-recognition`. Skip Cloudflare Whisper entirely.

**Consequences**: STT latency drops to near-zero — the LLM starts immediately after the user pauses. The trade-off is that audio is processed by Google's servers in Chrome (privacy implication), and browser support is best in Chrome/Edge. The Whisper step can be added back as a quality upgrade later, or used as a fallback for non-Chrome browsers. For v1 the latency benefit is decisive.

---

### ADR-002: react-speech-recognition over voice-activity-detection library

**Status**: Accepted

**Context**: `voice-activity-detection` (npm) is an energy/frequency threshold VAD that fires callbacks when it detects voice start/stop. It requires a separate recording step and manual audio encoding. `react-speech-recognition` wraps the Web Speech API and provides `interimTranscript` (live) and `finalTranscript` (phrase complete) — it handles VAD, recording, transcription, and silence detection in one hook.

**Decision**: Use `react-speech-recognition`.

**Consequences**: One library handles the entire browser-side speech pipeline. `continuous: true` mode keeps the mic open between phrases. `finalTranscript` fires automatically when the browser detects a natural pause — no threshold tuning needed. `interimTranscript` streams live text to the UI, giving the user real-time feedback that they're being heard. No WASM bundles, no separate VAD config.

---

### ADR-003: Durable Objects for WebSocket over plain Worker WebSocket

**Status**: Accepted

**Context**: Cloudflare Workers are stateless and ephemeral — they cannot maintain a persistent WebSocket connection. Two options: (1) plain Worker WebSocket (connection drops after the request handler completes); (2) Durable Objects with Hibernation WebSocket API (connection persists, DO hibernates when idle to save cost).

**Decision**: Durable Objects with Hibernation API. One DO instance per user session, identified by `session_id`.

**Consequences**: WebSocket connection persists for the lifetime of the user's session. DO hibernates when no messages are in flight, keeping costs low. The AI pipeline runs inside the DO — it has access to `env.AI` and `env.DB` bindings directly. State (`processing`, `sessionId`, `userId`) is held in DO memory during a turn. Hono in the Worker handles HTTP routing and forwards the WS upgrade to the DO.

---

### ADR-004: Deepgram Aura-1 over MeloTTS for TTS

**Status**: Accepted

**Context**: Two TTS options are available on Cloudflare Workers AI: `@cf/myshell-ai/melotts` (free-tier friendly, robotic quality) and `@cf/deepgram/aura-1` (Deepgram partner model, natural speech, multiple voices, $0.0150/1k chars).

**Decision**: Deepgram Aura-1 with `aura-asteria-en` voice.

**Consequences**: Noticeably more natural and human-sounding AI voice. Slightly higher cost per conversation. The voice model is a single parameter — can be changed to any Aura variant (`aura-orion-en`, `aura-luna-en`, `aura-zeus-en`) or swapped back to MeloTTS by changing one function call in `src/lib/ai.ts`. Natural voice quality is critical to the conversational feel of the app.

---

### ADR-005: Mic feedback loop prevention via state-gated listening

**Status**: Accepted

**Context**: When the AI's TTS audio plays through the speakers, the microphone can pick it up, causing the speech recognition to transcribe the AI's own speech and trigger another LLM turn — an infinite loop.

**Decision**: Stop `SpeechRecognition` while `convState` is `speaking`. The `useSpeechInput` hook accepts an `enabled` prop — it is `false` when the Persona is in speaking state. `useAudioPlayer` fires `onPlaybackEnd` when the audio finishes, which calls `startListening()` to resume the mic.

**Consequences**: Clean turn-taking. No echo or feedback loops. Users with headphones will not experience this issue at all, but the guard is needed for users on speakers. The mic resumes within ~100ms of audio playback ending.

---

### ADR-006: Zustand over React Context for global voice state

**Status**: Accepted

**Context**: Voice AI has complex, deeply nested shared state: `convState`, `messages`, `interimText`, `sessionId`, `showTranscript`, `aiConfig`. Managing this with `useState` + prop drilling across `App` → `PersonaView` → `TranscriptPanel` → `Controls` would require deeply nested props or a Context. React Context causes full subtree re-renders on every state change — undesirable given `interimText` updates on every word spoken.

**Decision**: Zustand store (`voiceStore.ts`) as global state manager.

**Consequences**: Any component can subscribe to only the slice of state it needs, with no prop drilling and minimal re-renders. `interimText` updates every 100ms during speech — Zustand's granular subscriptions mean only `PersonaView` re-renders for this, not the whole tree. The store is also accessible outside React (in hooks and audio event listeners) via `useVoiceStore.getState()`.

---

### ADR-007: AI Elements components over custom UI

**Status**: Accepted

**Context**: The Persona (animated AI avatar) and Conversation/Message (transcript display) components could be built from scratch or sourced from the AI Elements library.

**Decision**: Use AI Elements `Persona`, `Conversation`, `Message`, and `Shimmer` components.

**Consequences**: The `Persona` component provides 5 animated states (idle/listening/thinking/speaking/asleep) powered by Rive WebGL2 — building this from scratch would take significant effort. The `Conversation` and `Message` components provide a polished chat-style layout that matches the transcript requirement. AI Elements components are installed into the codebase (not imported from `node_modules`), giving full customisation access. The library is built on shadcn/ui which is already in the stack — zero additional style conflicts.

---

*End of specification.*
