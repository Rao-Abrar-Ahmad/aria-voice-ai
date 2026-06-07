# Voice AI — Complete Technical Specification

> **Implementation update**: The app now targets a continuous turn-based voice call. After the user clicks Start once, VAD silence detection automatically submits each spoken turn, the AI response is played, and listening resumes until the user clicks End. Settings now store the user's preferred name and additional AI instructions, not an editable assistant name.

> **Purpose**: End-to-end build specification for an AI agent or developer.  
> **Stack**: React + TypeScript (frontend) · Cloudflare Workers + Hono (backend) · Cloudflare Workers AI (STT/LLM/TTS) · Cloudflare D1 (database) · Cloudflare Workers + Workers Assets (hosting)  
> **Pattern**: Turn-based voice conversation with VAD silence detection, SSE streaming, persistent sessions, and a waveform UI.  
> **Project model**: Single unified project — Vite builds the React SPA into `dist/`, Hono Worker lives in `src/`, one `wrangler.jsonc` deploys everything.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Project Structure](#2-project-structure)
3. [Database Schema (D1)](#3-database-schema-d1)
4. [Configuration — wrangler.jsonc](#4-configuration--wranlerjsonc)
5. [Backend — Cloudflare Worker (Hono)](#5-backend--cloudflare-worker-hono)
6. [AI Pipeline](#6-ai-pipeline)
7. [Frontend — React SPA](#7-frontend--react-spa)
8. [Phase Build Plan](#8-phase-build-plan)
9. [Environment & Local Dev](#9-environment--local-dev)
10. [Deployment](#10-deployment)
11. [ADRs — Architecture Decision Records](#11-adrs--architecture-decision-records)

---

## 1. System Overview

### What it does

A single-page voice AI application where the user speaks, the AI listens, thinks, and speaks back. No text input required. Conversation history is persisted per user (identified by email or anonymous guest UUID) and survives page refresh.

### Turn-based pipeline

```
[Mic] → Silero VAD (silence detected) → Audio blob
     → POST /api/turn (multipart)
     → Worker: Whisper (STT) → SSE: "transcribing"
     → Worker: Llama 3.1 8B (LLM) → SSE: "thinking"
     → Worker: MeloTTS (TTS) → SSE: "speaking" + audio chunks
     → Worker: save to D1 → SSE: "done" + transcript
     → [Speaker plays AI audio]
     → [Transcription panel updates]
```

### How the SPA is served

The React SPA is built by Vite into `dist/`. The `wrangler.jsonc` `assets` binding points Cloudflare to that directory. Cloudflare serves static files directly from its CDN — no Hono route needed for the frontend. Hono only handles `/api/*` routes. All other paths fall through to the asset serving layer, which returns `index.html` (SPA fallback).

### Key decisions (all resolved via grilling session)

| Decision | Choice | Reason |
|---|---|---|
| Voice mode | Turn-based (VAD) | Fits Worker request/response model; real-time duplex not yet stable on CF |
| VAD library | `@ricky0123/vad-web` (Silero WASM) | Far more accurate than energy threshold in noisy environments |
| AI provider | Cloudflare Workers AI only | Full CF-native stack; no external API keys needed |
| STT model | `@cf/openai/whisper` | Best available on CF Workers AI |
| LLM model | `@cf/meta/llama-3.1-8b-instruct` | Good quality, fast, free on CF |
| TTS model | `@cf/myshell-ai/melotts` | English, CF-native |
| Backend framework | Hono on CF Workers | Lightweight router, clean multi-route API |
| AI SDK (Vercel) | Not used | Audio buffers don't benefit from text-stream abstraction |
| Conversation history | Client sends full history each turn | Simpler; history also stored in D1 for persistence |
| History persistence | Cloudflare D1 | Single CF platform; survives page refresh |
| Guest identity | LocalStorage UUID | No auth needed; ties guest to a stable identity |
| User identity | Email only (no password) | Lightweight identity; email stored in D1 |
| Language | English only (v1) | Simplest; TTS voice can swap later |
| Waveform style | Sine wave, 2-color canvas | User color vs AI color, premium feel, lightweight |
| Frontend framework | React + TypeScript SPA | Component model fits state machine complexity |
| UI library | Tailwind CSS + shadcn/ui | Familiar stack; shadcn for modals/popups |
| Project model | Single unified project | One `package.json`, one `wrangler.jsonc`, one deploy |
| Frontend serving | Workers Assets (CF-native CDN) | Recommended CF approach for full-stack Workers; no Pages needed |
| Config format | `wrangler.jsonc` | Cloudflare's preferred format; supports comments |
| Hosting | Cloudflare Workers | Everything on one Worker; no separate Pages project |

---

## 2. Project Structure

```
voice-ai/
├── src/                              # Cloudflare Worker (Hono backend)
│   ├── index.ts                      # Hono app entry, route registration
│   ├── routes/
│   │   ├── session.ts                # POST /api/session
│   │   ├── turn.ts                   # POST /api/turn (SSE endpoint)
│   │   ├── config.ts                 # GET|POST /api/config
│   │   └── history.ts                # GET /api/history
│   ├── lib/
│   │   ├── ai.ts                     # Workers AI pipeline (STT → LLM → TTS)
│   │   ├── db.ts                     # D1 query helpers
│   │   └── sse.ts                    # SSE stream writer utility
│   └── types.ts                      # Shared Worker TypeScript types
│
├── client/                           # React SPA (Vite source)
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── LandingPopup.tsx      # Email / guest entry modal
│   │   │   ├── WaveformCanvas.tsx    # Sine wave visualizer
│   │   │   ├── Controls.tsx          # Start/listening/end controls
│   │   │   ├── SettingsPopup.tsx     # User preferred name + custom AI instructions modal
│   │   │   ├── TranscriptPanel.tsx   # Chat-style transcript column
│   │   │   └── StatusIndicator.tsx   # transcribing/thinking/speaking badge
│   │   ├── hooks/
│   │   │   ├── useVAD.ts             # Silero VAD integration
│   │   │   ├── useAudioPlayer.ts     # Plays TTS audio blobs
│   │   │   ├── useWaveform.ts        # Web Audio AnalyserNode → canvas
│   │   │   ├── useSession.ts         # Session init, localStorage UUID
│   │   │   └── useSSE.ts             # Reads SSE stream from /api/turn
│   │   ├── store/
│   │   │   └── conversationStore.ts  # Zustand: messages, status, config
│   │   ├── lib/
│   │   │   └── api.ts                # Typed fetch wrappers for Worker API
│   │   └── types.ts
│   └── public/
│       ├── silero_vad.onnx           # Silero VAD WASM model (static asset)
│       └── vad.worklet.bundle.js     # Silero VAD audio worklet bundle
│
├── db/
│   └── 0001_initial.sql              # D1 migration
│
├── dist/                             # Vite build output → served by Workers Assets
│
├── wrangler.jsonc                    # Single Cloudflare config for Worker + Assets
├── vite.config.ts                    # Vite config (outDir: dist)
├── tailwind.config.ts
├── tsconfig.json                     # Root TS config (Worker)
├── tsconfig.client.json              # Client TS config (extends root)
└── package.json                      # Single unified package.json
```

---

## 3. Database Schema (D1)

### Migration file: `db/0001_initial.sql`

```sql
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

-- AI persona config: user preferred name + custom instructions per user
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
```

**Context window strategy**: Load the last **20 messages** (10 turns) for LLM history. Keeps token usage manageable while preserving meaningful context.

### Migration file: `db/0002_user_profile_config.sql`

Existing databases created before the user-profile config change must add:

```sql
ALTER TABLE ai_configs ADD COLUMN user_name TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_configs ADD COLUMN custom_instructions TEXT NOT NULL DEFAULT '';
```

The legacy `ai_name` and `system_prompt` columns remain for compatibility, but new app behavior uses `user_name` and `custom_instructions`.

---

## 4. Configuration — wrangler.jsonc

`wrangler.jsonc` is Cloudflare's preferred config format. It supports comments (`//` and `/* */`) unlike plain JSON, making it easier to document bindings inline.

### `wrangler.jsonc`

```jsonc
{
  // Worker name — becomes the subdomain: voice-ai.your-account.workers.dev
  "name": "voice-ai",

  // Worker entry point (Hono backend)
  "main": "src/index.ts",

  // Minimum compatibility date — keep up to date when adding new CF features
  "compatibility_date": "2024-09-23",

  // nodejs_compat enables Node.js built-ins (crypto, Buffer, etc.) in Workers
  "compatibility_flags": ["nodejs_compat"],

  // Workers Assets — Cloudflare serves the Vite build output as static files
  // from its CDN. Non-API requests fall through to index.html (SPA fallback).
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    // Serve index.html for all unmatched routes (React Router / SPA support)
    "not_found_handling": "single-page-application"
  },

  // Cloudflare D1 — SQLite at the edge
  "d1_databases": [
    {
      "binding": "DB",               // accessed as env.DB in Worker
      "database_name": "voice-ai-db",
      "database_id": "REPLACE_WITH_YOUR_D1_DATABASE_ID"
    }
  ],

  // Cloudflare Workers AI
  "ai": {
    "binding": "AI"                  // accessed as env.AI in Worker
  },

  // Environment variables (non-secret)
  "vars": {
    "ENVIRONMENT": "production"
  },

  // Local dev overrides — used by wrangler dev
  "env": {
    "development": {
      "vars": {
        "ENVIRONMENT": "development"
      }
    }
  }
}
```

### Notes on `wrangler.jsonc` vs `wrangler.toml`

- Cloudflare's own documentation and `wrangler init` scaffolding now defaults to `wrangler.jsonc`
- JSONC (JSON with Comments) is the preferred format — it supports inline documentation
- `wrangler.toml` still works but is considered legacy for new projects
- Never use plain `wrangler.json` — no comment support makes it harder to document bindings

---

## 5. Backend — Cloudflare Worker (Hono)

### `src/types.ts`

```typescript
export type Env = {
  DB: D1Database
  AI: Ai
  ASSETS: Fetcher        // Workers Assets binding
  ENVIRONMENT: string
}
```

### `src/index.ts` — Hono app entry

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { sessionRoute } from './routes/session'
import { turnRoute } from './routes/turn'
import { configRoute } from './routes/config'
import { historyRoute } from './routes/history'
import type { Env } from './types'

const app = new Hono<{ Bindings: Env }>()

// CORS is only needed during local dev (Vite on :5173, Worker on :8787)
// In production, frontend and API are same origin — no CORS required
app.use('/api/*', cors({
  origin: ['http://localhost:5173'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}))

app.route('/api/session', sessionRoute)
app.route('/api/turn', turnRoute)
app.route('/api/config', configRoute)
app.route('/api/history', historyRoute)

export default app
```

> **Note on CORS**: Because the React SPA and the Worker are deployed as the same origin (same `workers.dev` subdomain or custom domain), CORS headers are not needed in production. The `cors()` middleware is scoped to `/api/*` and only applies during local development when Vite runs on a different port.

### `src/routes/session.ts`

```typescript
import { Hono } from 'hono'
import { upsertUser, getOrCreateSession } from '../lib/db'
import type { Env } from '../types'

const app = new Hono<{ Bindings: Env }>()

// POST /api/session
// Body: { guest_id: string, email?: string }
// Returns: { session_id, user_id, is_new_user }
app.post('/', async (c) => {
  const { guest_id, email } = await c.req.json<{ guest_id: string; email?: string }>()

  if (!guest_id) return c.json({ error: 'guest_id required' }, 400)

  const user = await upsertUser(c.env.DB, { guest_id, email })
  const session = await getOrCreateSession(c.env.DB, user.id)

  return c.json({
    session_id: session.id,
    user_id: user.id,
    is_new_user: user.is_new,
  })
})

export { app as sessionRoute }
```

### `src/routes/turn.ts` — Main SSE endpoint

```typescript
import { Hono } from 'hono'
import { runAIPipeline } from '../lib/ai'
import { loadHistory, getUserByGuestId, getAiConfig } from '../lib/db'
import type { Env } from '../types'

const app = new Hono<{ Bindings: Env }>()

// POST /api/turn
// Body: multipart/form-data — audio: Blob, session_id: string, guest_id: string
// Returns: SSE stream
app.post('/', async (c) => {
  const formData = await c.req.formData()
  const audioBlob = formData.get('audio') as File
  const sessionId = formData.get('session_id') as string
  const guestId = formData.get('guest_id') as string

  if (!audioBlob || !sessionId || !guestId) {
    return c.json({ error: 'audio, session_id, and guest_id required' }, 400)
  }

  const user = await getUserByGuestId(c.env.DB, guestId)
  if (!user) return c.json({ error: 'user not found' }, 404)

  const [history, aiConfig] = await Promise.all([
    loadHistory(c.env.DB, sessionId, 20),
    getAiConfig(c.env.DB, user.id),
  ])

  const audioBuffer = await audioBlob.arrayBuffer()

  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  const send = (event: string, data: object) => {
    writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
  }

  c.executionCtx.waitUntil((async () => {
    try {
      await runAIPipeline({
        ai: c.env.AI,
        db: c.env.DB,
        audioBuffer,
        history,
        aiConfig,
        sessionId,
        onEvent: send,
      })
    } catch (err) {
      send('error', { message: 'Pipeline failed' })
    } finally {
      writer.close()
    }
  })())

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})

export { app as turnRoute }
```

### `src/routes/config.ts`

```typescript
import { Hono } from 'hono'
import { getAiConfig, upsertAiConfig, getUserByGuestId } from '../lib/db'
import type { Env } from '../types'

const app = new Hono<{ Bindings: Env }>()

// GET /api/config?guest_id=xxx
app.get('/', async (c) => {
  const guestId = c.req.query('guest_id')
  if (!guestId) return c.json({ error: 'guest_id required' }, 400)
  const user = await getUserByGuestId(c.env.DB, guestId)
  if (!user) return c.json({ error: 'user not found' }, 404)
  const config = await getAiConfig(c.env.DB, user.id)
  return c.json(config)
})

// POST /api/config
// Body: { guest_id, user_name, custom_instructions }
app.post('/', async (c) => {
  const { guest_id, user_name, custom_instructions } = await c.req.json()
  const user = await getUserByGuestId(c.env.DB, guest_id)
  if (!user) return c.json({ error: 'user not found' }, 404)
  const config = await upsertAiConfig(c.env.DB, user.id, {
    user_name,
    custom_instructions,
  })
  return c.json(config)
})

export { app as configRoute }
```

### `src/routes/history.ts`

```typescript
import { Hono } from 'hono'
import { loadHistory } from '../lib/db'
import type { Env } from '../types'

const app = new Hono<{ Bindings: Env }>()

// GET /api/history?session_id=xxx&limit=50
// Used on app load to hydrate the transcript panel
app.get('/', async (c) => {
  const sessionId = c.req.query('session_id')
  const limit = parseInt(c.req.query('limit') ?? '50', 10)
  if (!sessionId) return c.json({ error: 'session_id required' }, 400)
  const messages = await loadHistory(c.env.DB, sessionId, limit)
  return c.json({ messages })
})

export { app as historyRoute }
```

### `src/lib/db.ts` — D1 query helpers

> Current implementation note: config helpers now return and persist `user_name` and `custom_instructions`. Legacy `ai_name` and `system_prompt` are retained only so old rows remain readable.

```typescript
import type { D1Database } from '@cloudflare/workers-types'

export async function upsertUser(
  db: D1Database,
  { guest_id, email }: { guest_id: string; email?: string }
) {
  // Try find by guest_id first
  let user = await db.prepare('SELECT * FROM users WHERE guest_id = ?')
    .bind(guest_id).first<any>()

  if (!user) {
    // If email provided, check if email user already exists
    if (email) {
      user = await db.prepare('SELECT * FROM users WHERE email = ?')
        .bind(email).first<any>()
      if (user) {
        // Associate this guest_id with the existing email user
        await db.prepare('UPDATE users SET guest_id = ? WHERE id = ?')
          .bind(guest_id, user.id).run()
        return { ...user, is_new: false }
      }
    }
    // Create new user
    const id = crypto.randomUUID()
    await db.prepare('INSERT INTO users (id, email, guest_id) VALUES (?, ?, ?)')
      .bind(id, email ?? null, guest_id).run()
    user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>()
    return { ...user, is_new: true }
  }

  // Update email if now provided and not previously set
  if (email && !user.email) {
    await db.prepare('UPDATE users SET email = ? WHERE id = ?')
      .bind(email, user.id).run()
    user.email = email
  }

  return { ...user, is_new: false }
}

export async function getOrCreateSession(db: D1Database, userId: string) {
  // Single conversation model — always reuse existing session
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

  // Reverse to chronological order, map to LLM message format
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
  const config = await db.prepare('SELECT * FROM ai_configs WHERE user_id = ?')
    .bind(userId).first<any>()
  if (!config) {
    return {
      ai_name: 'Assistant',
      system_prompt:
        'You are a helpful voice assistant. Keep responses concise and conversational, suitable for being spoken aloud. Avoid markdown, bullet points, or any formatting — respond in plain spoken sentences only.',
    }
  }
  return config
}

export async function upsertAiConfig(
  db: D1Database,
  userId: string,
  { ai_name, system_prompt }: { ai_name: string; system_prompt: string }
) {
  const existing = await db.prepare('SELECT id FROM ai_configs WHERE user_id = ?')
    .bind(userId).first<any>()

  if (existing) {
    await db.prepare(
      `UPDATE ai_configs SET ai_name = ?, system_prompt = ?, updated_at = datetime('now')
       WHERE user_id = ?`
    ).bind(ai_name, system_prompt, userId).run()
  } else {
    const id = crypto.randomUUID()
    await db.prepare(
      'INSERT INTO ai_configs (id, user_id, ai_name, system_prompt) VALUES (?, ?, ?, ?)'
    ).bind(id, userId, ai_name, system_prompt).run()
  }

  return { ai_name, system_prompt }
}
```

---

## 6. AI Pipeline

### `src/lib/ai.ts`

```typescript
import type { Ai, D1Database } from '@cloudflare/workers-types'
import { insertMessage } from './db'

type Message = { role: 'user' | 'assistant'; content: string }
type AiConfig = { user_name?: string; custom_instructions?: string }
type SSEEvent = (event: string, data: object) => void

interface PipelineOptions {
  ai: Ai
  db: D1Database
  audioBuffer: ArrayBuffer
  history: Message[]
  aiConfig: AiConfig
  sessionId: string
  onEvent: SSEEvent
}

export async function runAIPipeline({
  ai, db, audioBuffer, history, aiConfig, sessionId, onEvent,
}: PipelineOptions) {

  // ── Step 1: STT — Whisper ────────────────────────────────────────────────
  onEvent('status', { state: 'transcribing' })

  const sttResult = await ai.run('@cf/openai/whisper', {
    audio: [...new Uint8Array(audioBuffer)],
  }) as { text: string }

  const userTranscript = sttResult.text?.trim()
  if (!userTranscript) {
    onEvent('error', { message: 'Could not transcribe audio' })
    return
  }

  onEvent('transcript_user', { text: userTranscript })
  await insertMessage(db, sessionId, 'user', userTranscript)

  // ── Step 2: LLM — Llama 3.1 8B ──────────────────────────────────────────
  onEvent('status', { state: 'thinking' })

  const messages: Message[] = [
    ...history,
    { role: 'user', content: userTranscript },
  ]

  const llmResult = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [
      { role: 'system', content: buildSystemPrompt(aiConfig) },
      ...messages,
    ],
    max_tokens: 300,
    temperature: 0.7,
  }) as { response: string }

  const aiResponseText = llmResult.response?.trim()
  if (!aiResponseText) {
    onEvent('error', { message: 'LLM returned empty response' })
    return
  }

  await insertMessage(db, sessionId, 'assistant', aiResponseText)

  // ── Step 3: TTS — MeloTTS ───────────────────────────────────────────────
  onEvent('status', { state: 'speaking' })
  onEvent('transcript_ai', { text: aiResponseText })

  const ttsResult = await ai.run('@cf/myshell-ai/melotts', {
    prompt: aiResponseText,
  }) as { audio: string } // base64-encoded WAV

  onEvent('audio', { data: ttsResult.audio, format: 'wav' })

  // ── Done ─────────────────────────────────────────────────────────────────
  onEvent('status', { state: 'done' })
}

function buildSystemPrompt(aiConfig: AiConfig): string {
  const parts = [
    'You are a helpful voice assistant. Keep responses concise and conversational, suitable for being spoken aloud. Avoid markdown, bullet points, lists, code fences, or visual formatting. Respond in plain spoken sentences only.',
  ]
  if (aiConfig.user_name) {
    parts.push(`The user's preferred name is ${aiConfig.user_name}. Address them naturally by this name when appropriate.`)
  }
  if (aiConfig.custom_instructions) {
    parts.push(`Additional user instructions: ${aiConfig.custom_instructions}`)
  }
  return parts.join('\n\n')
}
```

### SSE event contract

| Event | Payload | Description |
|---|---|---|
| `status` | `{ state: "transcribing" \| "thinking" \| "speaking" \| "done" }` | Current pipeline phase |
| `transcript_user` | `{ text: string }` | User's spoken words after STT |
| `transcript_ai` | `{ text: string }` | AI's response text |
| `audio` | `{ data: string (base64), format: "wav" }` | TTS audio to play |
| `error` | `{ message: string }` | Pipeline error |

---

## 7. Frontend — React SPA

### Conversation state machine

```
idle → listening   (VAD started)
     → transcribing (audio sent, SSE: status=transcribing)
     → thinking     (SSE: status=thinking)
     → speaking     (SSE: status=speaking)
     → listening    (SSE: status=done — auto-resumes)
     → idle         (user clicks End)
```

### Waveform color map

| State | Canvas behavior | Color |
|---|---|---|
| `idle` | Flat line | Gray `#6b7280` |
| `listening` | Live mic AnalyserNode data | Indigo `#6366f1` |
| `transcribing` | Slow breathing sine | Gray `#9ca3af` |
| `thinking` | Slow breathing sine | Gray `#9ca3af` |
| `speaking` | Live TTS audio AnalyserNode data | Emerald `#10b981` |

### `client/src/hooks/useVAD.ts`

```typescript
import { useMicVAD } from '@ricky0123/vad-react'

export function useVAD(onSpeechEnd: (audio: Float32Array) => void) {
  const vad = useMicVAD({
    startOnLoad: false,
    onSpeechEnd,
    // These static files must be present in client/public/
    modelURL: '/silero_vad.onnx',
    workletURL: '/vad.worklet.bundle.js',
    positiveSpeechThreshold: 0.8,
    negativeSpeechThreshold: 0.3,
    redemptionFrames: 8,    // ~800ms silence before onSpeechEnd fires
    preSpeechPadFrames: 10,
  })

  return {
    start: vad.start,
    pause: vad.pause,
    listening: vad.listening,
    userSpeaking: vad.userSpeaking,
  }
}
```

### `client/src/hooks/useWaveform.ts`

```typescript
import { useEffect, useRef } from 'react'

type WaveformState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

const STATE_COLORS: Record<WaveformState, string> = {
  idle: '#6b7280',
  listening: '#6366f1',    // indigo — user speaking
  transcribing: '#9ca3af',
  thinking: '#9ca3af',
  speaking: '#10b981',     // emerald — AI speaking
}

export function useWaveform(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  analyserRef: React.RefObject<AnalyserNode | null>,
  state: WaveformState
) {
  const animFrameRef = useRef<number>()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const color = STATE_COLORS[state]
    const isLive = state === 'listening' || state === 'speaking'
    const isBreathing = state === 'transcribing' || state === 'thinking'
    let phase = 0

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw)
      const W = canvas.width
      const H = canvas.height
      ctx.clearRect(0, 0, W, H)
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = 2.5
      ctx.lineCap = 'round'

      if (isLive && analyserRef.current) {
        const bufferLength = analyserRef.current.frequencyBinCount
        const dataArray = new Float32Array(bufferLength)
        analyserRef.current.getFloatTimeDomainData(dataArray)
        const sliceWidth = W / bufferLength
        let x = 0
        for (let i = 0; i < bufferLength; i++) {
          const y = (dataArray[i] * H * 2) + H / 2
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
          x += sliceWidth
        }
        phase += 0.05
      } else if (isBreathing) {
        phase += 0.02
        for (let x = 0; x <= W; x += 2) {
          const y = H / 2 + Math.sin((x / W) * Math.PI * 4 + phase) * 8
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        }
      } else {
        ctx.moveTo(0, H / 2)
        ctx.lineTo(W, H / 2)
      }

      ctx.stroke()
    }

    draw()
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current) }
  }, [state, canvasRef, analyserRef])
}
```

### `client/src/hooks/useSession.ts`

```typescript
import { useState } from 'react'

const GUEST_ID_KEY = 'voice_ai_guest_id'

export function useSession() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const getGuestId = (): string => {
    let id = localStorage.getItem(GUEST_ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(GUEST_ID_KEY, id)
    }
    return id
  }

  const initSession = async (email?: string) => {
    const guestId = getGuestId()
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest_id: guestId, email }),
    })
    const result = await res.json()
    setSessionId(result.session_id)
    setUserId(result.user_id)
    setReady(true)
    return result
  }

  return { sessionId, userId, ready, initSession, getGuestId }
}
```

### `client/src/hooks/useSSE.ts`

```typescript
import { useCallback } from 'react'

type SSEHandlers = {
  onStatus: (state: string) => void
  onTranscriptUser: (text: string) => void
  onTranscriptAI: (text: string) => void
  onAudio: (base64: string, format: string) => void
  onError: (message: string) => void
  onDone: () => void
}

export function useSSE() {
  const sendTurn = useCallback(async (
    audioBlob: Blob,
    sessionId: string,
    guestId: string,
    handlers: SSEHandlers
  ) => {
    const formData = new FormData()
    formData.append('audio', audioBlob, 'audio.wav')
    formData.append('session_id', sessionId)
    formData.append('guest_id', guestId)

    const response = await fetch('/api/turn', { method: 'POST', body: formData })
    if (!response.body) throw new Error('No response body')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) { handlers.onDone(); break }

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''

      for (const part of parts) {
        let event = 'message'
        let data = ''
        for (const line of part.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7)
          if (line.startsWith('data: ')) data = line.slice(6)
        }
        if (!data) continue
        const parsed = JSON.parse(data)
        switch (event) {
          case 'status':           handlers.onStatus(parsed.state); break
          case 'transcript_user':  handlers.onTranscriptUser(parsed.text); break
          case 'transcript_ai':    handlers.onTranscriptAI(parsed.text); break
          case 'audio':            handlers.onAudio(parsed.data, parsed.format); break
          case 'error':            handlers.onError(parsed.message); break
        }
      }
    }
  }, [])

  return { sendTurn }
}
```

### `client/src/components/WaveformCanvas.tsx`

```tsx
import { useRef, useEffect } from 'react'
import { useWaveform } from '../hooks/useWaveform'

type WaveformState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

interface Props {
  state: WaveformState
  analyserNode: AnalyserNode | null
}

export function WaveformCanvas({ state, analyserNode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(analyserNode)
  useEffect(() => { analyserRef.current = analyserNode }, [analyserNode])
  useWaveform(canvasRef, analyserRef, state)

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={160}
      className="w-full h-40 rounded-2xl bg-black/5 dark:bg-white/5"
    />
  )
}
```

### `client/src/components/LandingPopup.tsx`

```tsx
import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Props {
  open: boolean
  onContinue: (email?: string) => void
}

export function LandingPopup({ open, onContinue }: Props) {
  const [email, setEmail] = useState('')
  const [mode, setMode] = useState<'choice' | 'email'>('choice')

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-sm" hideClose>
        <DialogHeader>
          <DialogTitle className="text-center text-xl">Welcome</DialogTitle>
        </DialogHeader>

        {mode === 'choice' && (
          <div className="flex flex-col gap-3 pt-2">
            <button
              onClick={() => setMode('email')}
              className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition"
            >
              Sign in with email
            </button>
            <button
              onClick={() => onContinue(undefined)}
              className="w-full py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
            >
              Continue as guest
            </button>
          </div>
        )}

        {mode === 'email' && (
          <div className="flex flex-col gap-3 pt-2">
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && email && onContinue(email)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            />
            <button
              onClick={() => email && onContinue(email)}
              disabled={!email}
              className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition disabled:opacity-40"
            >
              Continue
            </button>
            <button onClick={() => setMode('choice')} className="text-sm text-gray-500 hover:text-gray-700 transition">
              ← Back
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

### `client/src/components/Controls.tsx`

```tsx
import { Mic, Square } from 'lucide-react'

type ConvState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

interface Props {
  state: ConvState
  onStart: () => void
  onStop: () => void
}

export function Controls({ state, onStart, onStop }: Props) {
  const isActive = state !== 'idle'
  const isProcessing = ['transcribing', 'thinking', 'speaking'].includes(state)

  const statusLabel: Record<ConvState, string> = {
    idle: '',
    listening: 'Listening',
    transcribing: 'Transcribing...',
    thinking: 'Thinking...',
    speaking: 'Speaking...',
  }

  return (
    <div className="flex items-center justify-center gap-4">
      {!isActive ? (
        <button
          onClick={onStart}
          className="flex items-center gap-2 px-6 py-3 rounded-full bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition shadow-lg"
        >
          <Mic size={18} />
          Start talking
        </button>
      ) : (
        <>
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-gray-100 dark:bg-gray-800 text-sm text-gray-500">
            <span className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-emerald-400' : 'bg-indigo-400'} animate-pulse`} />
            {statusLabel[state]}
          </div>
          <button
            onClick={onStop}
            className="flex items-center gap-2 px-4 py-3 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 hover:bg-red-200 transition"
          >
            <Square size={16} fill="currentColor" />
            End
          </button>
        </>
      )}
    </div>
  )
}
```

### `client/src/components/TranscriptPanel.tsx`

```tsx
import { useEffect, useRef } from 'react'

export type TranscriptMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

interface Props {
  messages: TranscriptMessage[]
  assistantName: string
}

export function TranscriptPanel({ messages, assistantName }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  return (
    <div className="flex flex-col gap-3 overflow-y-auto h-full p-4">
      {messages.map(msg => (
        <div key={msg.id} className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
          <span className="text-xs text-gray-400 px-1">
            {msg.role === 'user' ? 'You' : assistantName}
          </span>
          <div className={`px-4 py-2.5 rounded-2xl max-w-[85%] text-sm leading-relaxed ${
            msg.role === 'user'
              ? 'bg-indigo-600 text-white rounded-br-sm'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-sm'
          }`}>
            {msg.text}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
```

### `client/src/App.tsx` — Root layout and state orchestration

> Current implementation note: `App.tsx` uses a fixed visible assistant label (`Voice AI`) plus `conversationActiveRef`, `turnInProgressRef`, and VAD control refs. `onSpeechEnd` pauses VAD, submits the WAV turn automatically, waits for AI audio playback, and restarts VAD only if the user has not clicked End.

```tsx
import { useState, useRef, useCallback } from 'react'
import { WaveformCanvas } from './components/WaveformCanvas'
import { Controls } from './components/Controls'
import { LandingPopup } from './components/LandingPopup'
import { SettingsPopup } from './components/SettingsPopup'
import { TranscriptPanel, type TranscriptMessage } from './components/TranscriptPanel'
import { useVAD } from './hooks/useVAD'
import { useSession } from './hooks/useSession'
import { useSSE } from './hooks/useSSE'
import { Settings, PanelRight } from 'lucide-react'

type ConvState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

export default function App() {
  const [convState, setConvState] = useState<ConvState>('idle')
  const [showTranscript, setShowTranscript] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [aiName, setAiName] = useState('Assistant')
  const [showLanding, setShowLanding] = useState(true)

  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  const { sessionId, ready, initSession, getGuestId } = useSession()
  const { sendTurn } = useSSE()

  const handleSpeechEnd = useCallback(async (audio: Float32Array) => {
    if (!sessionId || convState !== 'listening') return
    const wav = float32ToWav(audio)
    setConvState('transcribing')

    await sendTurn(wav, sessionId, getGuestId(), {
      onStatus: (state) => {
        if (state === 'thinking') setConvState('thinking')
        if (state === 'speaking') setConvState('speaking')
        if (state === 'done') setConvState('listening') // auto-resume listening
      },
      onTranscriptUser: (text) =>
        setMessages(m => [...m, { id: crypto.randomUUID(), role: 'user', text }]),
      onTranscriptAI: (text) =>
        setMessages(m => [...m, { id: crypto.randomUUID(), role: 'assistant', text }]),
      onAudio: (base64, format) =>
        playBase64Audio(base64, format, audioCtxRef, analyserRef),
      onError: () => setConvState('idle'),
      onDone: () => {},
    })
  }, [sessionId, convState, sendTurn, getGuestId])

  const { start: startVAD, pause: pauseVAD } = useVAD(handleSpeechEnd)

  const handleStart = () => {
    initAudioContext(audioCtxRef, analyserRef)
    startVAD()
    setConvState('listening')
  }

  const handleStop = () => {
    pauseVAD()
    setConvState('idle')
  }

  const handleLandingContinue = async (email?: string) => {
    const result = await initSession(email)
    // Hydrate transcript from D1 history
    const histRes = await fetch(`/api/history?session_id=${result.session_id}&limit=50`)
    const { messages: history } = await histRes.json()
    setMessages(history.map((m: any) => ({
      id: crypto.randomUUID(),
      role: m.role,
      text: m.content,
    })))
    // Load AI config
    const cfgRes = await fetch(`/api/config?guest_id=${getGuestId()}`)
    const cfg = await cfgRes.json()
    setAiName(cfg.ai_name)
    setShowLanding(false)
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <LandingPopup open={showLanding} onContinue={handleLandingContinue} />
      <SettingsPopup
        open={showSettings}
        onClose={() => setShowSettings(false)}
        aiName={aiName}
        onSave={setAiName}
        guestId={getGuestId()}
      />

      <div className={`h-screen flex ${showTranscript ? 'flex-row' : 'flex-col'}`}>

        {/* Transcript panel (left column when toggled open) */}
        {showTranscript && (
          <div className="w-80 border-r border-gray-100 dark:border-gray-800 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 text-sm font-medium text-gray-500">
              Conversation
            </div>
            <TranscriptPanel messages={messages} aiName={aiName} />
          </div>
        )}

        {/* Main single-column layout */}
        <div className="flex-1 flex flex-col items-center justify-between p-8">
          <div className="w-full flex justify-between items-center">
            <h1 className="text-sm font-medium text-gray-400">{aiName}</h1>
            <div className="flex gap-2">
              <button
                onClick={() => setShowTranscript(s => !s)}
                className={`p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition ${showTranscript ? 'text-indigo-500' : 'text-gray-400'}`}
                title="Toggle transcript"
              >
                <PanelRight size={18} />
              </button>
              <button
                onClick={() => setShowSettings(true)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition text-gray-400"
                title="Settings"
              >
                <Settings size={18} />
              </button>
            </div>
          </div>

          <div className="w-full max-w-lg">
            <WaveformCanvas state={convState} analyserNode={analyserRef.current} />
          </div>

          <Controls state={convState} onStart={handleStart} onStop={handleStop} />
        </div>
      </div>
    </div>
  )
}

// ── Audio utilities ────────────────────────────────────────────────────────

function initAudioContext(
  audioCtxRef: React.MutableRefObject<AudioContext | null>,
  analyserRef: React.MutableRefObject<AnalyserNode | null>
) {
  if (!audioCtxRef.current) {
    audioCtxRef.current = new AudioContext()
    analyserRef.current = audioCtxRef.current.createAnalyser()
    analyserRef.current.fftSize = 1024
  }
}

async function playBase64Audio(
  base64: string,
  _format: string,
  audioCtxRef: React.MutableRefObject<AudioContext | null>,
  analyserRef: React.MutableRefObject<AnalyserNode | null>
) {
  if (!audioCtxRef.current) return
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const audioBuffer = await audioCtxRef.current.decodeAudioData(bytes.buffer.slice(0))
  const source = audioCtxRef.current.createBufferSource()
  source.buffer = audioBuffer
  if (analyserRef.current) {
    source.connect(analyserRef.current)
    analyserRef.current.connect(audioCtxRef.current.destination)
  } else {
    source.connect(audioCtxRef.current.destination)
  }
  source.start()
}

function float32ToWav(samples: Float32Array, sampleRate = 16000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const write = (o: number, s: string) => s.split('').forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)))
  write(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  write(8, 'WAVE'); write(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  write(36, 'data'); view.setUint32(40, samples.length * 2, true)
  const pcm = new Int16Array(buffer, 44)
  for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-1, Math.min(1, samples[i])) * 0x7fff
  return new Blob([buffer], { type: 'audio/wav' })
}
```

---

## 8. Phase Build Plan

### Phase 1A — Project scaffold

**Goal**: Unified project boots locally with `wrangler dev` serving both the Worker and the static SPA.

Tasks:
- [ ] `npm create cloudflare@latest voice-ai -- --type worker` (baseline scaffold)
- [ ] Install dependencies: `hono`, `@cloudflare/workers-types`, `typescript`, `wrangler`
- [ ] Install frontend dependencies: `react`, `react-dom`, `@vitejs/plugin-react`, `vite`, `tailwindcss`, `@ricky0123/vad-react`, `zustand`, `lucide-react`
- [ ] Install shadcn/ui: `npx shadcn@latest init`
- [ ] Create `wrangler.jsonc` (replace any generated `wrangler.toml`)
- [ ] Create `vite.config.ts` with `outDir: '../dist'` (builds into project root `dist/`)
- [ ] Create `tsconfig.json` (Worker) and `tsconfig.client.json` (React, extends root)
- [ ] Add scripts to `package.json`:
  ```json
  {
    "scripts": {
      "dev:worker": "wrangler dev",
      "dev:client": "vite client",
      "dev": "concurrently \"npm run dev:worker\" \"npm run dev:client\"",
      "build": "vite build client",
      "deploy": "npm run build && wrangler deploy"
    }
  }
  ```
- [ ] Verify `wrangler dev` starts on `:8787` and Vite starts on `:5173`

---

### Phase 1B — D1 database setup

**Goal**: D1 database created, migrated, and queryable from the Worker.

Tasks:
- [ ] `npx wrangler d1 create voice-ai-db`
- [ ] Copy `database_id` output into `wrangler.jsonc`
- [ ] Create `db/0001_initial.sql` with full schema
- [ ] Run migration locally: `npx wrangler d1 execute voice-ai-db --local --file=db/0001_initial.sql`
- [ ] Run migration remotely: `npx wrangler d1 execute voice-ai-db --remote --file=db/0001_initial.sql`
- [ ] Implement `src/lib/db.ts` with all query helpers
- [ ] Test `upsertUser` and `getOrCreateSession` via a temporary test route

---

### Phase 1C — Backend routes

**Goal**: All API endpoints respond correctly.

Tasks:
- [ ] Implement `src/types.ts`
- [ ] Implement `src/index.ts` (Hono app, route registration, CORS)
- [ ] Implement `src/routes/session.ts`
- [ ] Implement `src/routes/config.ts`
- [ ] Implement `src/routes/history.ts`
- [ ] Stub `src/routes/turn.ts` (return a fixed SSE sequence for now, no AI yet)
- [ ] Test all endpoints with curl:

```bash
# Session (guest)
curl -X POST http://localhost:8787/api/session \
  -H "Content-Type: application/json" \
  -d '{"guest_id":"test-1234"}'
# Expected: { session_id, user_id, is_new_user: true }

# Session (email)
curl -X POST http://localhost:8787/api/session \
  -H "Content-Type: application/json" \
  -d '{"guest_id":"test-1234","email":"user@test.com"}'

# Config
curl "http://localhost:8787/api/config?guest_id=test-1234"
# Expected: { user_name: "", custom_instructions: "" }

# History
curl "http://localhost:8787/api/history?session_id=SESSION_ID&limit=50"
# Expected: { messages: [] }
```

---

### Phase 1D — AI pipeline

**Goal**: `/api/turn` accepts audio, runs the full STT→LLM→TTS pipeline, streams SSE events.

Tasks:
- [ ] Implement `src/lib/ai.ts` (full pipeline)
- [ ] Implement `src/routes/turn.ts` (SSE streaming with real AI)
- [ ] Test with a real WAV file:

```bash
curl -X POST http://localhost:8787/api/turn \
  -F "audio=@test.wav" \
  -F "session_id=SESSION_ID" \
  -F "guest_id=test-1234" \
  --no-buffer
# Expected: stream of SSE events ending with status=done
```

- [ ] Confirm D1 `messages` table is populated after each turn
- [ ] Confirm base64 audio in the `audio` SSE event decodes to audible WAV

---

### Phase 2A — Frontend skeleton

**Goal**: React SPA builds, loads in browser, landing popup works.

Tasks:
- [ ] Create `client/index.html`, `client/src/main.tsx`, `client/src/App.tsx` (minimal)
- [ ] Copy Silero VAD static assets to `client/public/`: `silero_vad.onnx`, `vad.worklet.bundle.js`
- [ ] Implement `useSession` hook
- [ ] Implement `LandingPopup` component
- [ ] On submit: call `/api/session`, load history from `/api/history`, load config from `/api/config`
- [ ] Store `session_id` in React state; verify it survives page refresh (localStorage UUID stays stable)
- [ ] `npm run build` → confirm `dist/` is populated
- [ ] Verify Workers Assets serves `dist/index.html` on `http://localhost:8787/`

---

### Phase 2B — Voice pipeline integration

**Goal**: User speaks → AI responds with audio.

Tasks:
- [ ] Implement `useVAD` hook
- [ ] Implement `useSSE` hook
- [ ] Implement `float32ToWav` utility
- [ ] Implement `playBase64Audio` utility with `AnalyserNode` connection
- [ ] Wire up full turn cycle in `App.tsx`
- [ ] Test full round trip: speak → see state transitions → hear AI response

---

### Phase 2C — Waveform visualizer

**Goal**: Sine wave canvas animates correctly per state, colors shift between user and AI.

Tasks:
- [ ] Implement `useWaveform` hook
- [ ] Implement `WaveformCanvas` component
- [ ] Connect `AnalyserNode` to mic stream during `listening`
- [ ] Connect `AnalyserNode` to TTS audio source during `speaking`
- [ ] Verify: indigo wave during user speech, emerald wave during AI speech
- [ ] Verify: breathing animation during `transcribing` / `thinking`

---

### Phase 3A — Controls and settings

**Goal**: Full controls and settings popup functional.

Tasks:
- [ ] Implement `Controls` component
- [ ] Implement `SettingsPopup` component (user preferred name + custom AI instructions)
- [ ] On settings save: `POST /api/config`, persist `user_name` and `custom_instructions`
- [ ] On settings open: pre-fill from current state (loaded at session init)
- [ ] Confirm custom instructions are appended to the protected base system prompt on the next turn

---

### Phase 3B — Transcript panel

**Goal**: Split-view transcript works with real-time updates and history hydration.

Tasks:
- [ ] Implement `TranscriptPanel` component
- [ ] `PanelRight` icon button toggles `showTranscript` → layout shifts to `flex-row`
- [ ] Messages append in real-time from SSE `transcript_user` and `transcript_ai` events
- [ ] Auto-scroll to bottom on new message
- [ ] Confirm history messages loaded from D1 on session init populate the panel correctly

---

### Phase 3C — Polish and edge cases

Tasks:
- [ ] Handle microphone permission denied — show clear error message
- [ ] Prevent overlapping turns — disable VAD while `speaking`, re-enable on `done`
- [ ] Handle empty STT result — show a brief toast, return to `listening`
- [ ] Handle Worker pipeline errors (SSE `error` event) — show toast, return to `idle`
- [ ] Add loading skeleton / spinner during session init (before landing popup dismisses)
- [ ] Dark mode (Tailwind `dark:` throughout all components)
- [ ] Mobile responsive: hide transcript panel toggle on screens < `sm`, single column only
- [ ] Add `<meta>` tags in `client/index.html` (title, description, viewport)

---

## 9. Environment & Local Dev

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
    outDir: '../dist',   // builds into project root dist/
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // In local dev: forward /api/* to the Worker running on :8787
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      }
    }
  }
})
```

### `package.json`

```json
{
  "name": "voice-ai",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev:worker": "wrangler dev",
    "dev:client": "vite client",
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
    "@ricky0123/vad-react": "^0.0.19",
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
    "concurrently": "^8.0.0"
  }
}
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

## 10. Deployment

```bash
# ── One-time setup ─────────────────────────────────────────────────────────

# 1. Create D1 database
npx wrangler d1 create voice-ai-db
# → Copy the database_id into wrangler.jsonc

# 2. Run D1 migration on remote
npm run db:migrate:remote

# ── Every deploy ───────────────────────────────────────────────────────────

# 3. Build React SPA + deploy Worker + Assets in one command
npm run deploy
# Internally: vite build → dist/ → wrangler deploy (uploads Worker + assets)

# ── Result ─────────────────────────────────────────────────────────────────
# https://voice-ai.YOUR-ACCOUNT.workers.dev
# - GET /          → React SPA (served from Workers Assets CDN)
# - POST /api/*    → Hono Worker routes
# - All other GET  → index.html (SPA fallback via not_found_handling)
```

### Custom domain (optional)

In the Cloudflare dashboard: Workers & Pages → voice-ai → Settings → Domains & Routes → Add Custom Domain.

### No CORS config needed in production

Frontend and API share the same origin in production (both on `workers.dev` or your custom domain). The `cors()` middleware in `src/index.ts` is scoped to local dev only.

---

## 11. ADRs — Architecture Decision Records

### ADR-001: Turn-based voice over real-time duplex streaming

**Status**: Accepted

**Context**: Voice AI can be turn-based (one party speaks at a time, like a phone call) or real-time duplex (both parties can interrupt simultaneously). Cloudflare Workers have a 30-second CPU time limit and operate in a request/response model without persistent connections.

**Decision**: Turn-based with Silero VAD silence detection. The browser records until VAD fires `onSpeechEnd`, then sends the full audio clip as a single HTTP request.

**Consequences**: Clean request/response fits Workers' execution model. No WebSocket or WebRTC infrastructure needed. 1–2 second AI processing latency feels natural for a turn-based exchange. Real-time duplex can be added in a future version via Durable Objects with WebSockets.

---

### ADR-002: Silero VAD over energy-threshold silence detection

**Status**: Accepted

**Context**: Two options for detecting speech end: (1) monitor audio energy, stop after N ms below a threshold — zero dependencies, unreliable in noise; (2) `@ricky0123/vad-web` Silero WASM model, ~1MB, ML-based speech detection.

**Decision**: Silero VAD.

**Consequences**: ~1MB WASM bundle loaded once and cached. Silero is trained specifically for speech vs non-speech and handles background noise accurately. Energy threshold causes frequent false mid-sentence cutoffs which would severely damage conversation flow. Accuracy is clearly worth the bundle cost.

---

### ADR-003: Full Cloudflare-native AI stack

**Status**: Accepted

**Context**: OpenAI Whisper API, GPT-4o, and ElevenLabs offer higher quality STT, LLM, and TTS. Cloudflare Workers AI offers lower-quality equivalents but keeps the entire stack on one platform.

**Decision**: Cloudflare Workers AI for all three (Whisper, Llama 3.1 8B, MeloTTS) in v1.

**Consequences**: No external API keys, no external billing, no cross-service egress latency. Voice and LLM quality are lower than best-in-class. Each step is a single function call in `ai.ts` — any step can be swapped to an external provider independently without changing the SSE contract to the frontend.

---

### ADR-004: Single unified project over monorepo

**Status**: Accepted

**Context**: Frontend and backend can be separated as a monorepo (two `package.json`, Turborepo, separate build commands) or kept as a single project (one `package.json`, one build, one deploy).

**Decision**: Single unified project.

**Consequences**: One `wrangler.jsonc` defines the entire deployable unit. `npm run deploy` builds the SPA and deploys the Worker + Assets in one command. Simpler for AI agents to execute — no workspace coordination, no cross-package imports needed. Monorepo can be adopted later if the project grows significantly.

---

### ADR-005: Workers Assets over Cloudflare Pages

**Status**: Accepted

**Context**: Two ways to serve a static SPA alongside a Worker: (1) Cloudflare Pages with a Worker integration; (2) Workers Assets — the `assets` binding in `wrangler.jsonc` that serves static files from the same Worker.

**Decision**: Workers Assets.

**Consequences**: Single deployment unit. Cloudflare now recommends Workers Assets over Pages for new full-stack Worker projects. The `not_found_handling: "single-page-application"` option handles the React Router fallback automatically. No separate Pages project, no Pages-specific build pipeline or environment variables.

---

### ADR-006: wrangler.jsonc over wrangler.toml

**Status**: Accepted

**Context**: Wrangler supports three config formats: `wrangler.toml` (legacy default), `wrangler.json` (JSON, no comments), `wrangler.jsonc` (JSON with Comments, current default).

**Decision**: `wrangler.jsonc`.

**Consequences**: Cloudflare's own `wrangler init` and documentation now default to `wrangler.jsonc`. Comments allow inline documentation of bindings, database IDs, and feature flags directly in the config — critical for maintainability and AI agent comprehension. `wrangler.toml` still works but is not recommended for new projects.

---

### ADR-007: Same-origin deployment — no CORS in production

**Status**: Accepted

**Context**: When frontend and backend are separate deployments (e.g. Vercel + CF Workers), CORS headers are required for every API call. With Workers Assets, both are served from the same `workers.dev` subdomain.

**Decision**: No CORS headers in production. `cors()` middleware in Hono is restricted to `/api/*` and only applies during local development.

**Consequences**: Fewer headers per request, no preflight round-trips, no risk of CORS misconfiguration blocking API calls in production. Local development uses Vite's `proxy` config to forward `/api/*` to the Worker port, maintaining same-origin behaviour locally as well.

---

*End of specification.*
