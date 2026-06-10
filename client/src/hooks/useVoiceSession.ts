import { useCallback } from 'react'
import { checkSession, initSession, loadConfig, loadHistory } from '../lib/api'
import { useVoiceStore } from '../store/voiceStore'

const GUEST_ID_KEY = 'voice-ai.guest-id'

function getStoredGuestId() {
  return localStorage.getItem(GUEST_ID_KEY)
}

function getOrCreateGuestId() {
  const existing = localStorage.getItem(GUEST_ID_KEY)
  if (existing) return existing

  const id = crypto.randomUUID()
  localStorage.setItem(GUEST_ID_KEY, id)
  return id
}

export function useVoiceSession() {
  const setSession = useVoiceStore((state) => state.setSession)
  const setMessages = useVoiceStore((state) => state.setMessages)
  const setConfig = useVoiceStore((state) => state.setConfig)

  const restoreSession = useCallback(async () => {
    const session = await checkSession(getStoredGuestId() ?? undefined)
    if (!session) return null

    setSession(session.session_id, session.user_id)

    const [history, config] = await Promise.allSettled([loadHistory(), loadConfig()])
    if (history.status === 'fulfilled') setMessages(history.value)
    if (config.status === 'fulfilled') setConfig(config.value)

    return session
  }, [setConfig, setMessages, setSession])

  const startSession = useCallback(
    async (email?: string) => {
      const guestId = getOrCreateGuestId()
      const session = await initSession(guestId, email)
      setSession(session.session_id, session.user_id)

      const [history, config] = await Promise.allSettled([loadHistory(), loadConfig()])
      if (history.status === 'fulfilled') setMessages(history.value)
      if (config.status === 'fulfilled') setConfig(config.value)

      return session
    },
    [setConfig, setMessages, setSession],
  )

  return { guestId: getStoredGuestId(), startSession, restoreSession }
}
