import { Hono } from 'hono'
import { getAiConfig, upsertAiConfig, getUserByGuestId } from '../lib/db'
import type { Env } from '../types'

const app = new Hono<{ Bindings: Env }>()

// GET /api/config?guest_id=xxx
app.get('/', async (c) => {
  const guestId = c.req.query('guest_id')
  console.log('GET /api/config', { guestId })
  if (!guestId) return c.json({ error: 'guest_id required' }, 400)
  const user = await getUserByGuestId(c.env.DB, guestId)
  if (!user) return c.json({ error: 'user not found' }, 404)
  const config = await getAiConfig(c.env.DB, user.id)
  console.log('GET /api/config result', { userId: user.id, config })
  return c.json(config)
})

// POST /api/config
// Body: { guest_id, user_name, custom_instructions }
app.post('/', async (c) => {
  const body = await c.req.json<{
    guest_id?: string
    user_name?: string
    custom_instructions?: string
    ai_name?: string
    system_prompt?: string
  }>()
  console.log('POST /api/config', { body })
  const guest_id = body.guest_id
  if (!guest_id) return c.json({ error: 'guest_id required' }, 400)
  const user = await getUserByGuestId(c.env.DB, guest_id)
  if (!user) return c.json({ error: 'user not found' }, 404)
  const config = await upsertAiConfig(c.env.DB, user.id, {
    user_name: (body.user_name ?? body.ai_name ?? '').trim(),
    custom_instructions: (body.custom_instructions ?? body.system_prompt ?? '').trim(),
  })
  console.log('POST /api/config result', { userId: user.id, config })
  return c.json(config)
})

export { app as configRoute }
