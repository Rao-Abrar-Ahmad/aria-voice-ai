import type { AiConfig, SessionResponse, TranscriptMessage } from '../types'

export async function initSession(guestId: string, email?: string) {
  const response = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ guest_id: guestId, email }),
  })

  if (!response.ok) throw new Error('Could not start session')
  return response.json() as Promise<SessionResponse>
}

export async function loadHistory() {
  const response = await fetch('/api/history?limit=50', { credentials: 'include' })
  if (!response.ok) throw new Error('Could not load history')
  const data = (await response.json()) as { messages: Array<{ role: 'user' | 'assistant'; content: string }> }
  return data.messages.map<TranscriptMessage>((message) => ({
    id: crypto.randomUUID(),
    role: message.role,
    content: message.content,
  }))
}

export async function loadConfig() {
  const response = await fetch('/api/config', { credentials: 'include' })
  if (!response.ok) throw new Error('Could not load config')
  return response.json() as Promise<AiConfig>
}

export async function saveConfig(config: AiConfig) {
  const response = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(config),
  })

  if (!response.ok) throw new Error('Could not save config')
  return response.json() as Promise<AiConfig>
}

export async function checkSession(guestId?: string): Promise<SessionResponse | null> {
  const response = await fetch('/api/session/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(guestId ? { guest_id: guestId } : {}),
  })

  if (!response.ok) return null
  return response.json() as Promise<SessionResponse>
}
