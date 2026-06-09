import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getCookie } from 'hono/cookie'
import { sessionRoute } from './routes/session'
import { configRoute } from './routes/config'
import { historyRoute } from './routes/history'
import type { Env } from './types'

export { VoiceSession } from './durable-objects/VoiceSession'

const app = new Hono<{ Bindings: Env }>()

// CORS is only needed during local dev (Vite on :5173, Worker on :8787)
// In production, frontend and API are same origin — no CORS required
app.use('/api/*', cors({
  origin: ['http://localhost:5173'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  credentials: true,
}))

app.route('/api/session', sessionRoute)
app.route('/api/config', configRoute)
app.route('/api/history', historyRoute)

app.get('/ws', async (c) => {
  const sessionId = getCookie(c, 'session_id') ?? c.req.query('session_id')
  if (!sessionId) return c.json({ error: 'No session' }, 401)

  const id = c.env.VOICE_SESSION.idFromName(sessionId)
  const stub = c.env.VOICE_SESSION.get(id)

  return stub.fetch(c.req.raw)
})

export default app
