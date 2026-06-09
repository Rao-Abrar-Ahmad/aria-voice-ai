import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { loadHistory } from '../lib/db'
import type { Env } from '../types'

const app = new Hono<{ Bindings: Env }>()

// GET /api/history?limit=50
// Used on app load to hydrate the transcript panel
app.get('/', async (c) => {
  const sessionId = getCookie(c, 'session_id')
  const limit = parseInt(c.req.query('limit') ?? '50', 10)
  if (!sessionId) return c.json({ error: 'Unauthorized' }, 401)
  const messages = await loadHistory(c.env.DB, sessionId, limit)
  return c.json({ messages })
})

export { app as historyRoute }
