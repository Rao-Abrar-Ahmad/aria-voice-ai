import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic } from 'lucide-react'
import { ConversationControls } from './components/ConversationControls'
import { LandingPopup } from './components/LandingPopup'
import { PersonaView } from './components/PersonaView'
import { SettingsPopup } from './components/SettingsPopup'
import { TranscriptPanel } from './components/TranscriptPanel'
import { useAudioPlayer } from './hooks/useAudioPlayer'
import { useSpeechInput } from './hooks/useSpeechRecognition'
import { useVoiceSession } from './hooks/useVoiceSession'
import { useVoiceWebSocket } from './hooks/useVoiceWebSocket'
import { useVoiceStore } from './store/voiceStore'
import 'regenerator-runtime/runtime'
import Header from './components/Header'

const GREETING_TEXT = "Hi, I'm Aria. How's your day going?"
const GREETING_AUDIO_URL = '/audio/aria-greeting.mp3'

export default function App() {
  const [showLanding, setShowLanding] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [initializing, setInitializing] = useState(false)
  const active = useVoiceStore((state) => state.active)
  const convState = useVoiceStore((state) => state.convState)
  const showTranscript = useVoiceStore((state) => state.showTranscript)
  const error = useVoiceStore((state) => state.error)
  const setActive = useVoiceStore((state) => state.setActive)
  const setConvState = useVoiceStore((state) => state.setConvState)
  const setInterimText = useVoiceStore((state) => state.setInterimText)
  const setError = useVoiceStore((state) => state.setError)
  const addMessage = useVoiceStore((state) => state.addMessage)
  const resetConversation = useVoiceStore((state) => state.resetConversation)
  const { startSession, restoreSession } = useVoiceSession()
  const notifyAudioDoneRef = useRef<() => void>(() => { })
  const greetingPlayedRef = useRef(false)
  const playingGreetingRef = useRef(false)

  const handleAudioEnded = useCallback(() => {
    if (playingGreetingRef.current) {
      playingGreetingRef.current = false
      if (useVoiceStore.getState().active) {
        setConvState('listening')
      }
      return
    }

    notifyAudioDoneRef.current()
    if (useVoiceStore.getState().active) {
      setConvState('listening')
    }
  }, [setConvState])

  const audio = useAudioPlayer(handleAudioEnded)
  const socket = useVoiceWebSocket((data, format) => {
    setConvState('speaking')
    void audio.play(data, format)
  })
  notifyAudioDoneRef.current = socket.notifyAudioDone

  const handleFinalTranscript = useCallback(
    (text: string) => {
      if (!text.trim() || convState === 'speaking') return
      setInterimText('')
      setConvState('thinking')
      const sent = socket.sendTranscript(text)
      if (!sent) {
        setError('Connection is not ready yet. Please try again in a moment.')
        setConvState('error')
      }
    },
    [convState, setConvState, setError, setInterimText, socket],
  )

  const speech = useSpeechInput(active && convState === 'listening', handleFinalTranscript)

  useEffect(() => {
    let cancelled = false

    const checkExistingSession = async () => {
      try {
        const session = await restoreSession()
        if (!cancelled) setShowLanding(!session)
      } catch {
        if (!cancelled) setShowLanding(true)
      } finally {
        if (!cancelled) setCheckingSession(false)
      }
    }

    checkExistingSession()

    return () => {
      cancelled = true
    }
  }, [restoreSession])

  const handleLandingContinue = async (email?: string) => {
    setInitializing(true)
    setError('')
    try {
      await startSession(email)
      setShowLanding(false)
    } catch (err: any) {
      setError(err?.message ?? 'Session initialization failed.')
    } finally {
      setInitializing(false)
    }
  }

  const handleStartConversation = () => {
    if (!speech.supported) {
      setError('This browser does not support Web Speech recognition. Chrome or Edge is recommended.')
      return
    }

    socket.connect()
    setActive(true)

    if (greetingPlayedRef.current) {
      setConvState('listening')
      return
    }

    greetingPlayedRef.current = true
    playingGreetingRef.current = true
    addMessage({ id: crypto.randomUUID(), role: 'assistant', content: GREETING_TEXT })
    setConvState('speaking')

    void audio.playUrl(GREETING_AUDIO_URL).catch(() => {
      playingGreetingRef.current = false
      setConvState('listening')
      setError('Greeting audio is missing. Run npm run generate:greeting to create it.')
    })
  }

  const handleEndConversation = () => {
    playingGreetingRef.current = false
    audio.stop()
    socket.close()
    resetConversation()
  }

  return (
    <div className="min-h-screen overflow-hidden bg-zinc-50 text-zinc-950 transition-colors dark:bg-zinc-950 dark:text-zinc-50">
      <LandingPopup open={!checkingSession && showLanding} onContinue={handleLandingContinue} />
      <SettingsPopup open={showSettings} onClose={() => setShowSettings(false)} />


      {initializing && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/60 backdrop-blur-md">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-teal-500 border-t-transparent" />
          <p className="text-sm font-semibold tracking-wider text-white">Initializing voice session...</p>
        </div>
      )}

      {!active ? (
        <main className="flex min-h-screen flex-col items-center justify-evenly gap-8 px-4">
          <Header />
          <PersonaView />
          <button
            onClick={handleStartConversation}
            disabled={checkingSession || showLanding || initializing}
            className="inline-flex items-center gap-2 rounded-full bg-teal-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-teal-600/20 transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Mic size={20} />
            Start Conversation
          </button>
          {error && <p className="max-w-md text-center text-sm text-red-600 dark:text-red-300">{error}</p>}
          {!speech.microphoneAvailable && (
            <p className="max-w-md text-center text-sm text-red-600 dark:text-red-300">Microphone permission is unavailable.</p>
          )}
        </main>
      ) : (
        <main className={`w-full flex h-screen overflow-hidden flex-row`}>

          <aside className={` h-full bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 opacity-50 ${showTranscript ? 'w-80 shrink-0' : '-translate-x-full absolute'} transition-all duration-300 ease-in-out`}>
            <TranscriptPanel type='desktop' />
          </aside>


          <section className="h-full w-full flex basis-full flex-1 flex-col items-center justify-center px-5 py-6 sm:px-8 sm:py-10">
            {/* <div className="flex w-full justify-end gap-2">
              <button
                onClick={() => setShowSettings(true)}
                className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 sm:hidden"
              >
                Settings
              </button>
            </div> */}

            <PersonaView />

            <div className="flex flex-col items-center gap-3">
              {error && <p className="max-w-md text-center text-sm text-red-600 dark:text-red-300">{error}</p>}
              <ConversationControls onEnd={handleEndConversation} onSettingsOpen={() => setShowSettings(true)} />
            </div>
          </section>
        </main>
      )}
    </div>
  )
}
