import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { getOrCreateSession, getSessionBySessionId, upsertUser } from '../lib/db'
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

// POST /api/session/check
// Body: { guest_id?: string }
// Returns: { session_id, user_id } if a session exists for this guest or cookie
// Used to restore session on page reload without showing landing popup
app.post('/check', async (c) => {
  const { guest_id } = await c.req.json<{ guest_id?: string }>()

  let sessionId = getCookie(c, 'session_id')
  let userId = ''

  if (guest_id) {
    const user = await c.env.DB
      .prepare('SELECT id FROM users WHERE guest_id = ?')
      .bind(guest_id)
      .first<{ id: string }>()

    if (user) {
      const session = await getOrCreateSession(c.env.DB, user.id)
      sessionId = session.id
      userId = user.id
    }
  }

  if (!userId && sessionId) {
    const session = await getSessionBySessionId(c.env.DB, sessionId)
    if (!session) return c.json({ error: 'No session found' }, 401)
    userId = session.user_id
  }

  if (!sessionId || !userId) return c.json({ error: 'No session found' }, 401)

  setCookie(c, 'session_id', sessionId, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: new URL(c.req.url).protocol === 'https:' && c.env.ENVIRONMENT === 'production',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })

  return c.json({
    session_id: sessionId,
    user_id: userId,
    is_new_user: false,
  })
})

export { app as sessionRoute }
