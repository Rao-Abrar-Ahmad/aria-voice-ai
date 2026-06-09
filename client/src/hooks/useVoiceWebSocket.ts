import { useCallback, useEffect, useRef } from 'react'
import { useVoiceStore } from '../store/voiceStore'

export function useVoiceWebSocket(onAudio: (data: string, format: string) => void) {
  const sessionId = useVoiceStore((state) => state.sessionId)
  const setConvState = useVoiceStore((state) => state.setConvState)
  const addMessage = useVoiceStore((state) => state.addMessage)
  const appendAssistantChunk = useVoiceStore((state) => state.appendAssistantChunk)
  const setWsConnected = useVoiceStore((state) => state.setWsConnected)
  const setError = useVoiceStore((state) => state.setError)
  const wsRef = useRef<WebSocket | null>(null)

  const connect = useCallback(() => {
    if (!sessionId || wsRef.current?.readyState === WebSocket.OPEN) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?session_id=${sessionId}`)
    wsRef.current = ws

    ws.onopen = () => setWsConnected(true)
    ws.onclose = () => setWsConnected(false)
    ws.onerror = () => setError('WebSocket connection failed.')
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)

      if (message.type === 'status') {
        if (['idle', 'listening', 'thinking', 'speaking'].includes(message.state)) {
          setConvState(message.state === 'idle' ? 'listening' : message.state)
        }
      }

      if (message.type === 'transcript_confirmed') {
        addMessage({ id: crypto.randomUUID(), role: 'user', content: message.text })
      }

      if (message.type === 'llm_chunk') {
        appendAssistantChunk(message.text)
      }

      if (message.type === 'audio') {
        onAudio(message.data, message.format)
      }

      if (message.type === 'error') {
        setError(message.message)
        setConvState('error')
      }
    }
  }, [addMessage, appendAssistantChunk, onAudio, sessionId, setConvState, setError, setWsConnected])

  const sendTranscript = useCallback((text: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return false
    wsRef.current.send(JSON.stringify({ type: 'transcript', text }))
    return true
  }, [])

  const notifyAudioDone = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: 'audio_playback_done' }))
  }, [])

  const close = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
    setWsConnected(false)
  }, [setWsConnected])

  useEffect(() => close, [close])

  return { connect, sendTranscript, notifyAudioDone, close }
}

