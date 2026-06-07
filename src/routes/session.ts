import { Hono } from 'hono'
import { upsertUser, getOrCreateSession } from '../lib/db'
import type { Env } from '../types'

const app = new Hono<{ Bindings: Env }>()

// POST /api/session
// Body: { guest_id: string, email?: string }
// Returns: { session_id, user_id, is_new_user }
app.post('/', async (c) => {
  const { guest_id, email } = await c.req.json<{ guest_id: string; email?: string }>()
  console.log('POST /api/session', { guest_id, email })

  if (!guest_id) return c.json({ error: 'guest_id required' }, 400)

  const user = await upsertUser(c.env.DB, { guest_id, email })
  const session = await getOrCreateSession(c.env.DB, user.id)

  console.log('POST /api/session result', { userId: user.id, sessionId: session.id, is_new_user: user.is_new })

  return c.json({
    session_id: session.id,
    user_id: user.id,
    is_new_user: user.is_new,
  })
})

export { app as sessionRoute }
