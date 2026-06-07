import { useState } from 'react'

const GUEST_ID_KEY = 'voice_ai_guest_id'

export function useSession() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const getGuestId = (): string => {
    let id = localStorage.getItem(GUEST_ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(GUEST_ID_KEY, id)
    }
    return id
  }

  const initSession = async (email?: string) => {
    const guestId = getGuestId()
    console.log('initSession: starting', { guestId, email })
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest_id: guestId, email }),
    })
    console.log('initSession: response', { status: res.status, ok: res.ok })
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '')
      console.error('initSession: failed response body', bodyText)
      throw new Error(`Failed to initialize session: ${res.statusText}`)
    }
    const result = await res.json()
    console.log('initSession: success', result)
    setSessionId(result.session_id)
    setUserId(result.user_id)
    setReady(true)
    return result
  }

  return { sessionId, userId, ready, initSession, getGuestId }
}
