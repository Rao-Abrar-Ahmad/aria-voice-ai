import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { getAiConfig, getSessionBySessionId, upsertAiConfig } from '../lib/db'
import type { Env } from '../types'

const app = new Hono<{ Bindings: Env }>()

app.get('/', async (c) => {
  const sessionId = getCookie(c, 'session_id')
  if (!sessionId) return c.json({ error: 'Unauthorized' }, 401)

  const session = await getSessionBySessionId(c.env.DB, sessionId)
  if (!session) return c.json({ error: 'Session not found' }, 404)

  const config = await getAiConfig(c.env.DB, session.user_id)
  return c.json(config)
})

app.post('/', async (c) => {
  const sessionId = getCookie(c, 'session_id')
  if (!sessionId) return c.json({ error: 'Unauthorized' }, 401)

  const session = await getSessionBySessionId(c.env.DB, sessionId)
  if (!session) return c.json({ error: 'Session not found' }, 404)

  const body = await c.req.json<{ ai_name?: string; system_prompt?: string }>()
  const config = await upsertAiConfig(c.env.DB, session.user_id, {
    ai_name: body.ai_name ?? '',
    system_prompt: body.system_prompt ?? '',
  })

  return c.json(config)
})

export { app as configRoute }
