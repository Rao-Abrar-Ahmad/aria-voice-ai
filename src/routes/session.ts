import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { upsertUser, getOrCreateSession } from '../lib/db'
import type { Env } from '../types'

const app = new Hono<{ Bindings: Env }>()

// POST /api/session
// Body: { guest_id: string, email?: string }
// Returns: { session_id, user_id, is_new_user }
// Sets: HttpOnly session_id cookie
app.post('/', async (c) => {
  const { guest_id, email } = await c.req.json<{ guest_id: string; email?: string }>()

  if (!guest_id) return c.json({ error: 'guest_id is required' }, 400)

  const user = await upsertUser(c.env.DB, { guest_id, email })
  const session = await getOrCreateSession(c.env.DB, user.id)

  setCookie(c, 'session_id', session.id, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: new URL(c.req.url).protocol === 'https:' && c.env.ENVIRONMENT === 'production',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })

  return c.json({
    session_id: session.id,
    user_id: user.id,
    is_new_user: user.is_new,
  })
})

export { app as sessionRoute }
