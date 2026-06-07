import { useCallback } from 'react'

type SSEHandlers = {
  onStatus: (state: string) => void
  onTranscriptUser: (text: string) => void
  onTranscriptPartial?: (text: string) => void
  onTranscriptAI: (text: string) => void
  onAudio: (base64: string, format: string) => void
  onTiming?: (payload: { stage: string; start: number; end: number; duration_ms: number }) => void
  onError: (message: string) => void
  onDone: () => void
}

export function useSSE() {
  const sendTurn = useCallback(async (
    audioBlob: Blob,
    sessionId: string,
    guestId: string,
    handlers: SSEHandlers
  ) => {
    console.log('sendTurn: start', { sessionId, guestId, audioSize: audioBlob.size })
    const formData = new FormData()
    formData.append('audio', audioBlob, 'audio.wav')
    formData.append('session_id', sessionId)
    formData.append('guest_id', guestId)

    const response = await fetch('/api/turn', { method: 'POST', body: formData })
    console.log('sendTurn: fetch completed', { status: response.status, ok: response.ok })
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      console.error('sendTurn: response not ok', { status: response.status, statusText: response.statusText, bodyText })
      throw new Error(`Turn request failed: ${response.status} ${response.statusText}`)
    }
    if (!response.body) throw new Error('No response body')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          handlers.onDone()
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          if (!part.trim()) continue
          let event = 'message'
          let data = ''
          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7).trim()
            if (line.startsWith('data: ')) data = line.slice(6).trim()
          }
          if (!data) continue
          try {
            const parsed = JSON.parse(data)
            console.log('sendTurn: SSE event', { event, parsed })
            switch (event) {
              case 'status':
                handlers.onStatus(parsed.state)
                break
              case 'transcript_partial':
                handlers.onTranscriptPartial && handlers.onTranscriptPartial(parsed.text)
                break
              case 'transcript_user':
                handlers.onTranscriptUser(parsed.text)
                break
              case 'timing':
                handlers.onTiming && handlers.onTiming(parsed)
                break
              case 'transcript_ai':
                handlers.onTranscriptAI(parsed.text)
                break
              case 'audio':
                handlers.onAudio(parsed.data, parsed.format)
                break
              case 'error':
                handlers.onError(parsed.message)
                break
            }
          } catch (e) {
            console.error('Error parsing SSE event data:', e)
          }
        }
      }
    } catch (err: any) {
      console.error('sendTurn: stream processing error', err)
      handlers.onError(err.message || 'Stream processing error')
    } finally {
      reader.releaseLock()
      console.log('sendTurn: stream processing finished')
    }
  }, [])

  return { sendTurn }
}
