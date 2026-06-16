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

  // Microphone testing states and refs
  const [micState, setMicState] = useState<'idle' | 'requesting' | 'testing' | 'ready'>('idle')
  const [audioLevels, setAudioLevels] = useState<number[]>([4, 4, 4, 4, 4, 4, 4, 4, 4, 4])
  const testStreamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  const cleanupMicTest = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (testStreamRef.current) {
      testStreamRef.current.getTracks().forEach((track) => track.stop())
      testStreamRef.current = null
    }
    if (audioCtxRef.current) {
      if (audioCtxRef.current.state !== 'closed') {
        void audioCtxRef.current.close()
      }
      audioCtxRef.current = null
    }
    analyserRef.current = null
  }, [])

  useEffect(() => {
    return () => {
      cleanupMicTest()
    }
  }, [cleanupMicTest])

  const startMicTest = async () => {
    setMicState('requesting')
    setError('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      testStreamRef.current = stream
      setMicState('testing')

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioContextClass) {
        setMicState('ready')
        return
      }

      const audioCtx = new AudioContextClass()
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 64
      const source = audioCtx.createMediaStreamSource(stream)
      source.connect(analyser)

      audioCtxRef.current = audioCtx
      analyserRef.current = analyser

      const bufferLength = analyser.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)

      let voiceDetectedTime = 0
      const updateVolume = () => {
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(dataArray)

        let sum = 0
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i]
        }
        const average = sum / bufferLength

        const newLevels = Array.from({ length: 10 }).map((_, index) => {
          const frequencyValue = dataArray[index % bufferLength] || 0
          return Math.max(4, Math.round((frequencyValue / 255) * 100))
        })
        setAudioLevels(newLevels)

        // Threshold of average volume to identify active voice/input
        if (average > 10) {
          voiceDetectedTime++
          if (voiceDetectedTime > 5) {
            setMicState('ready')
          }
        }

        animationFrameRef.current = requestAnimationFrame(updateVolume)
      }

      animationFrameRef.current = requestAnimationFrame(updateVolume)
    } catch (err: any) {
      console.error('Error accessing microphone:', err)
      setError('Microphone access denied. Please allow microphone access in your browser to start.')
      setMicState('idle')
    }
  }

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

  const proceedToStartConversation = () => {
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

  const handleStartConversationClick = async () => {
    setError('')
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const result = await navigator.permissions.query({ name: 'microphone' as PermissionName })
        if (result.state === 'granted') {
          proceedToStartConversation()
          return
        }
      } catch (err) {
        console.warn('Permissions API query for microphone not supported:', err)
      }
    }
    await startMicTest()
  }

  const handleDoneTesting = () => {
    cleanupMicTest()
    setMicState('idle')
    proceedToStartConversation()
  }

  const handleEndConversation = () => {
    playingGreetingRef.current = false
    audio.stop()
    socket.close()
    resetConversation()
  }
  console.log(error)
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

          <div className="flex flex-col items-center gap-4 w-full max-w-sm">
            {micState === 'idle' && (
              <button
                onClick={handleStartConversationClick}
                disabled={checkingSession || showLanding || initializing}
                className="inline-flex items-center gap-2 rounded-full bg-teal-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-teal-600/20 transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Mic size={20} />
                Start Conversation
              </button>
            )}

            {micState === 'requesting' && (
              <button
                disabled
                className="inline-flex items-center gap-3 rounded-full bg-zinc-200 px-8 py-4 text-base font-semibold text-zinc-500 shadow-md dark:bg-zinc-800 dark:text-zinc-400"
              >
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent dark:border-zinc-400" />
                Permission Needed...
              </button>
            )}

            {(micState === 'testing' || micState === 'ready') && (
              <div className="flex flex-col items-center gap-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 w-80">
                <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 text-center animate-pulse">
                  {micState === 'testing' ? 'Speak something...' : 'Mic is working!'}
                </p>

                {/* Animated Sound Bars */}
                <div className="flex items-end justify-center gap-1.5 h-16 w-full px-4">
                  {audioLevels.map((level, i) => (
                    <div
                      key={i}
                      className="w-2 rounded-full bg-teal-500 transition-all duration-75"
                      style={{ height: `${level}%` }}
                    />
                  ))}
                </div>

                {micState === 'ready' ? (
                  <button
                    onClick={handleDoneTesting}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-base font-semibold text-white shadow-md transition hover:bg-teal-700"
                  >
                    Done
                  </button>
                ) : (
                  <button
                    disabled
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-100 py-3 text-base font-semibold text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
                  >
                    Waiting for voice input...
                  </button>
                )}
              </div>
            )}

            {error && <p className="max-w-md text-center text-sm text-red-600 dark:text-red-300">{error}</p>}
            {!speech.microphoneAvailable && micState === 'idle' && (
              <p className="max-w-md text-center text-sm text-red-600 dark:text-red-300">Microphone permission is unavailable.</p>
            )}
          </div>
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
