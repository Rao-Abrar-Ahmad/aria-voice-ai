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
