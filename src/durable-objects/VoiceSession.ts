import type { DurableObjectState } from '@cloudflare/workers-types'
import { getAiConfig, getSessionBySessionId, insertMessage, loadHistory } from '../lib/db'
import { runLLM, runTTS } from '../lib/ai'
import type { Env, Message } from '../types'

type ClientMessage =
  | { type: 'ping' }
  | { type: 'audio_playback_done' }
  | { type: 'transcript'; text: string }

export class VoiceSession {
  private processing = false

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request) {
    const upgrade = request.headers.get('Upgrade')
    if (upgrade !== 'websocket') return new Response('Expected WebSocket', { status: 426 })

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    const sessionId = this.getSessionId(request)

    server.accept()

    if (!sessionId) {
      server.send(JSON.stringify({ type: 'error', message: 'No session' }))
      server.close(1008, 'No session')
      return new Response(null, { status: 101, webSocket: client })
    }

    server.addEventListener('message', (event) => {
      void this.handleMessage(server, sessionId, event.data)
    })

    server.send(JSON.stringify({ type: 'status', state: 'idle' }))
    return new Response(null, { status: 101, webSocket: client })
  }

  private getSessionId(request: Request) {
    const url = new URL(request.url)
    const querySession = url.searchParams.get('session_id')
    if (querySession) return querySession

    const cookie = request.headers.get('Cookie') ?? ''
    return cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('session_id='))
      ?.split('=')[1]
  }

  private async handleMessage(ws: WebSocket, sessionId: string, raw: string | ArrayBuffer) {
    let message: ClientMessage
    try {
      message = JSON.parse(String(raw))
    } catch {
      this.send(ws, { type: 'error', message: 'Invalid message' })
      return
    }

    if (message.type === 'ping') {
      this.send(ws, { type: 'pong' })
      return
    }

    if (message.type === 'audio_playback_done') {
      this.send(ws, { type: 'status', state: 'idle' })
      return
    }

    if (message.type !== 'transcript') return

    const text = message.text.trim()
    if (!text || this.processing) return

    this.processing = true
    try {
      await this.processTranscript(ws, sessionId, text)
    } catch (error: any) {
      this.send(ws, { type: 'error', message: error?.message ?? 'Voice turn failed' })
      this.send(ws, { type: 'status', state: 'idle' })
    } finally {
      this.processing = false
    }
  }

  private async processTranscript(ws: WebSocket, sessionId: string, text: string) {
    const session = await getSessionBySessionId(this.env.DB, sessionId)
    if (!session) {
      this.send(ws, { type: 'error', message: 'Session not found' })
      return
    }

    await insertMessage(this.env.DB, sessionId, 'user', text)
    this.send(ws, { type: 'transcript_confirmed', text })
    this.send(ws, { type: 'status', state: 'thinking' })

    const config = await getAiConfig(this.env.DB, session.user_id)
    const history = await loadHistory(this.env.DB, sessionId, 30)
    const llmInput: Message[] = history

    let assistantText = ''
    const generator = runLLM(this.env.AI, llmInput, config)

    while (true) {
      const next = await generator.next()
      if (next.done) {
        assistantText = next.value
        break
      }
      this.send(ws, { type: 'llm_chunk', text: next.value })
    }

    if (!assistantText.trim()) {
      throw new Error('LLM returned no response')
    }

    await insertMessage(this.env.DB, sessionId, 'assistant', assistantText)
    this.send(ws, { type: 'status', state: 'speaking' })

    const audio = await runTTS(this.env.AI, assistantText)
    if (!audio.data) throw new Error('TTS returned no audio')

    this.send(ws, { type: 'audio', data: audio.data, format: audio.format })
  }

  private send(ws: WebSocket, payload: unknown) {
    if (ws.readyState === WebSocket.READY_STATE_OPEN) {
      ws.send(JSON.stringify(payload))
    }
  }
}
