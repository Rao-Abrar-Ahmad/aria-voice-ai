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

// WebSocket /ws/turn
app.get('/ws', async (c) => {
  // Create a WebSocketPair (Cloudflare Workers)
  const pair = new WebSocketPair()
  const [client, server] = Object.values(pair)

  server.accept()

  // Streamed audio chunks will be accumulated here until finalization.
  const chunks: Uint8Array[] = []
  let sessionId = ''
  let guestId = ''

  server.addEventListener('message', async (evt: any) => {
    try {
      const data = typeof evt.data === 'string' ? JSON.parse(evt.data) : null
      if (!data) return

      if (data.type === 'init') {
        sessionId = data.session_id
        guestId = data.guest_id
        server.send(JSON.stringify({ type: 'status', status: 'ws_opened' }))
        return
      }

      if (data.type === 'audio_chunk') {
        // Expect base64-encoded PCM frame
        const b64 = data.payload
        const bytes = Uint8Array.from(atob(b64), (c: any) => c.charCodeAt(0))
        chunks.push(bytes)
        // Ack receipt
        server.send(JSON.stringify({ type: 'ack', received: bytes.length }))
        return
      }

      if (data.type === 'end') {
        // Combine chunks and run pipeline in background
        const totalLen = chunks.reduce((s, c) => s + c.length, 0)
        const combined = new Uint8Array(totalLen)
        let offset = 0
        for (const cbuf of chunks) {
          combined.set(cbuf, offset)
          offset += cbuf.length
        }

        // Fire-and-forget pipeline; send status updates via the socket
        c.executionCtx.waitUntil((async () => {
          try {
            // For now call runAIPipeline with full audioBuffer; runAIPipeline may emit events via provided onEvent
            await runAIPipeline({
              ai: c.env.AI,
              db: c.env.DB,
              audioBuffer: combined.buffer,
              history: [],
              aiConfig: undefined,
              sessionId,
              onEvent: (event, payload) => {
                try {
                  server.send(JSON.stringify({ type: 'sse', event, payload }))
                } catch (e) {
                  console.error('Failed to send event over ws', e)
                }
              },
            } as any)
          } catch (err: any) {
            server.send(JSON.stringify({ type: 'error', message: err?.message || String(err) }))
          }
        })())

        server.send(JSON.stringify({ type: 'status', status: 'processing_started' }))
        return
      }
    } catch (err) {
      console.error('WS handler error', err)
      try { server.send(JSON.stringify({ type: 'error', message: String(err) })) } catch (_) {}
    }
  })

  server.addEventListener('close', () => {
    // Cleanup
  })

  return new Response(null, { status: 101, webSocket: client })
})

export { app as turnRoute }
