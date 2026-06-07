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
  const audioBlob = formData.get('audio') as File | null
  const sessionId = formData.get('session_id') as string
  const guestId = formData.get('guest_id') as string

  console.log('POST /api/turn received', { guestId, sessionId, audioSize: audioBlob?.size ?? 0 })

  if (!audioBlob || !sessionId || !guestId) {
    console.error('POST /api/turn missing required fields', { guestId, sessionId, hasAudio: Boolean(audioBlob) })
    return c.json({ error: 'audio, session_id, and guest_id required' }, 400)
  }

  const user = await getUserByGuestId(c.env.DB, guestId)
  if (!user) return c.json({ error: 'user not found' }, 404)

  const [history, aiConfig] = await Promise.all([
    loadHistory(c.env.DB, sessionId, 20),
    getAiConfig(c.env.DB, user.id),
  ])

  console.log('POST /api/turn loaded history and config', { historyLength: history.length, aiConfig })

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
    } catch (err: any) {
      send('error', { message: `Pipeline failed: ${err.message || err}` })
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
