import { useRef, useState, useCallback } from 'react'

type WSMessage = { type: string; [key: string]: any }

export function useWS() {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)

  const connect = useCallback((opts: { sessionId: string; guestId: string }, onMessage?: (msg: WSMessage) => void) => {
    if (wsRef.current) wsRef.current.close()
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${protocol}://${window.location.host}/api/turn/ws`
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.addEventListener('open', () => {
      setConnected(true)
      ws.send(JSON.stringify({ type: 'init', session_id: opts.sessionId, guest_id: opts.guestId }))
    })

    ws.addEventListener('message', (ev) => {
      let data: any = ev.data
      try { data = typeof data === 'string' ? JSON.parse(data) : data } catch (e) {}
      onMessage && onMessage(data)
    })

    ws.addEventListener('close', () => setConnected(false))
    ws.addEventListener('error', () => setConnected(false))

    return ws
  }, [])

  const sendAudioChunk = useCallback((pcmBytes: Uint8Array) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false

    // Convert to base64 string
    let binary = ''
    const len = pcmBytes.length
    for (let i = 0; i < len; i++) binary += String.fromCharCode(pcmBytes[i])
    const b64 = btoa(binary)
    ws.send(JSON.stringify({ type: 'audio_chunk', payload: b64 }))
    return true
  }, [])

  const endStream = useCallback(() => {
    const ws = wsRef.current
    if (!ws) return
    try { ws.send(JSON.stringify({ type: 'end' })) } catch (e) {}
  }, [])

  const close = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
    setConnected(false)
  }, [])

  return { connect, connected, sendAudioChunk, endStream, close }
}

export default useWS
