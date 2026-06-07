import { useState, useRef, useCallback, type MutableRefObject } from 'react'
import { WaveformCanvas } from './components/WaveformCanvas'
import { Controls } from './components/Controls'
import { LandingPopup } from './components/LandingPopup'
import { SettingsPopup } from './components/SettingsPopup'
import { TranscriptPanel, type TranscriptMessage } from './components/TranscriptPanel'
import { useVAD } from './hooks/useVAD'
import { useSession } from './hooks/useSession'
import { useSSE } from './hooks/useSSE'
import { Settings, PanelRight } from 'lucide-react'
import type { WaveformState } from './hooks/useWaveform'

const ASSISTANT_NAME = 'Voice AI'

export default function App() {
  const [convState, setConvState] = useState<WaveformState>('idle')
  const [showTranscript, setShowTranscript] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [showLanding, setShowLanding] = useState(true)
  const [initializing, setInitializing] = useState(false)

  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const conversationActiveRef = useRef(false)
  const turnInProgressRef = useRef(false)
  const vadControlsRef = useRef<{ start: () => void; pause: () => void }>({
    start: () => {},
    pause: () => {},
  })

  const { sessionId, initSession, getGuestId } = useSession()
  const { sendTurn } = useSSE()

  const stopMicFeedback = useCallback(() => {
    if (micSourceRef.current) {
      micSourceRef.current.disconnect()
      micSourceRef.current = null
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop())
      micStreamRef.current = null
    }
  }, [])

  const restartMicFeedback = useCallback(async () => {
    stopMicFeedback()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      micStreamRef.current = stream
      if (audioCtxRef.current && analyserRef.current) {
        const source = audioCtxRef.current.createMediaStreamSource(stream)
        micSourceRef.current = source
        source.connect(analyserRef.current)
      }
    } catch (err) {
      console.warn('Could not restart mic stream for visualizer feedback:', err)
    }
  }, [stopMicFeedback])

  const handleSpeechEnd = useCallback(async (audio: Float32Array) => {
    console.log('handleSpeechEnd: triggered', { audioLength: audio.length, sessionId, conversationActive: conversationActiveRef.current, turnInProgress: turnInProgressRef.current })
    if (!sessionId || !conversationActiveRef.current || turnInProgressRef.current) return

    turnInProgressRef.current = true
    console.log('handleSpeechEnd: pausing VAD and stopping mic feedback')
    await pauseVAD()
    stopMicFeedback()
    setConvState('transcribing')

    let audioPlayPromise = Promise.resolve()
    let hadTurnError = false

    try {
      console.log('handleSpeechEnd: sending turn to backend')
      await sendTurn(float32ToWav(audio), sessionId, getGuestId(), {
        onStatus: (state) => {
          console.log('SSE onStatus', state)
          if (state === 'transcribing') setConvState('transcribing')
          if (state === 'thinking') setConvState('thinking')
          if (state === 'speaking') setConvState('speaking')
        },
        onTranscriptUser: (text) => {
          console.log('SSE onTranscriptUser', text)
          setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'user', text }])
        },
        onTranscriptAI: (text) => {
          console.log('SSE onTranscriptAI', text)
          setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'assistant', text }])
        },
        onAudio: (base64) => {
          console.log('SSE onAudio received', { base64Length: base64.length })
          audioPlayPromise = playBase64Audio(base64, audioCtxRef, analyserRef, currentAudioSourceRef)
        },
        onError: (message) => {
          hadTurnError = true
          conversationActiveRef.current = false
          console.error('SSE Pipeline error:', message)
          setConvState('idle')
        },
        onDone: async () => {
          console.log('SSE onDone')
          await audioPlayPromise
          turnInProgressRef.current = false
          if (!hadTurnError && conversationActiveRef.current) {
            await restartMicFeedback()
            vadControlsRef.current.start()
            setConvState('listening')
          }
        },
      })
    } catch (err) {
      console.error('Error in speech end flow:', err)
      conversationActiveRef.current = false
      turnInProgressRef.current = false
      setConvState('idle')
    }
  }, [sessionId, sendTurn, getGuestId, stopMicFeedback, restartMicFeedback])

  const { start: startVAD, pause: pauseVAD, errored: vadError, loading: vadLoading } = useVAD(handleSpeechEnd)
  vadControlsRef.current = { start: startVAD, pause: pauseVAD }

  if (vadError) {
    console.error('VAD hook error:', vadError)
  }

  const handleStart = async () => {
    console.log('handleStart: invoked', { conversationActive: conversationActiveRef.current })
    if (conversationActiveRef.current) return

    initAudioContext(audioCtxRef, analyserRef)
    if (audioCtxRef.current?.state === 'suspended') {
      console.log('handleStart: resuming suspended audio context')
      await audioCtxRef.current.resume()
    }

    conversationActiveRef.current = true
    turnInProgressRef.current = false
    await restartMicFeedback()
    try {
      await startVAD()
      console.log('handleStart: VAD started, listening state')
      setConvState('listening')
    } catch (err) {
      console.error('handleStart: VAD failed to start', err)
      conversationActiveRef.current = false
      setConvState('idle')
    }
  }

  const handleStop = () => {
    console.log('handleStop: invoked')
    conversationActiveRef.current = false
    turnInProgressRef.current = false
    pauseVAD()
    setConvState('idle')
    stopMicFeedback()
    if (currentAudioSourceRef.current) {
      try {
        currentAudioSourceRef.current.stop()
      } catch (e) {
        console.warn('handleStop: error stopping audio source', e)
      }
      currentAudioSourceRef.current = null
    }
  }

  const handleLandingContinue = async (email?: string) => {
    setInitializing(true)
    try {
      const result = await initSession(email)

      try {
        const histRes = await fetch(`/api/history?session_id=${result.session_id}&limit=50`)
        if (histRes.ok) {
          const { messages: history } = await histRes.json()
          setMessages(
            history.map((m: any) => ({
              id: crypto.randomUUID(),
              role: m.role,
              text: m.content,
            }))
          )
        }
      } catch (e) {
        console.warn('Could not load history:', e)
      }

      setShowLanding(false)
    } catch (err) {
      console.error('Session initialization failed:', err)
    } finally {
      setInitializing(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 transition-colors duration-300">
      <LandingPopup open={showLanding} onContinue={handleLandingContinue} />
      <SettingsPopup
        open={showSettings}
        onClose={() => setShowSettings(false)}
        guestId={getGuestId()}
      />

      {initializing && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex flex-col items-center justify-center gap-3">
          <div className="w-10 h-10 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin" />
          <p className="text-sm font-semibold tracking-wider text-white">Initializing Voice Session...</p>
        </div>
      )}

      <div className={`h-screen flex ${showTranscript ? 'flex-row' : 'flex-col'} overflow-hidden`}>
        {showTranscript && (
          <div className="w-80 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col h-full animate-in slide-in-from-left duration-300">
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <span className="text-sm font-bold tracking-tight text-zinc-800 dark:text-zinc-200">Conversation history</span>
              <span className="px-2 py-0.5 text-[10px] bg-zinc-100 dark:bg-zinc-800 font-semibold rounded-full text-zinc-500">
                {messages.length} messages
              </span>
            </div>
            <div className="flex-1 overflow-hidden">
              <TranscriptPanel messages={messages} assistantName={ASSISTANT_NAME} />
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col items-center justify-between p-6 md:p-8 h-full bg-slate-50/50 dark:bg-zinc-950/50">
          <header className="w-full max-w-4xl flex justify-between items-center bg-white dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800/80 px-5 py-3 rounded-2xl shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <h1 className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{ASSISTANT_NAME}</h1>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setShowTranscript((s) => !s)}
                className={`p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition ${
                  showTranscript ? 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/30' : 'text-zinc-400 dark:text-zinc-500'
                }`}
                title="Toggle transcript"
              >
                <PanelRight size={18} />
              </button>
              <button
                onClick={() => setShowSettings(true)}
                className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition text-zinc-400 dark:text-zinc-500"
                title="Settings"
              >
                <Settings size={18} />
              </button>
            </div>
          </header>

          <main className="flex-1 w-full max-w-lg flex flex-col items-center justify-center gap-8 py-12">
            <div className="w-full">
              <WaveformCanvas state={convState} analyserNode={analyserRef.current} />
            </div>

            <div className="h-6">
              {convState === 'listening' && (
                <p className="text-xs font-medium tracking-wide text-indigo-500 dark:text-indigo-400 animate-pulse">
                  Listening for your speech...
                </p>
              )}
            </div>

            <Controls state={convState} onStart={handleStart} onStop={handleStop} />
          </main>

          <footer className="w-full max-w-4xl text-center">
            <span className="text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600 font-semibold">
              Powering AI on Cloudflare Workers AI
            </span>
          </footer>
        </div>
      </div>
    </div>
  )
}

function initAudioContext(
  audioCtxRef: MutableRefObject<AudioContext | null>,
  analyserRef: MutableRefObject<AnalyserNode | null>
) {
  if (!audioCtxRef.current) {
    audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    analyserRef.current = audioCtxRef.current.createAnalyser()
    analyserRef.current.fftSize = 1024
  }
}

async function playBase64Audio(
  base64: string,
  audioCtxRef: MutableRefObject<AudioContext | null>,
  analyserRef: MutableRefObject<AnalyserNode | null>,
  currentAudioSourceRef: MutableRefObject<AudioBufferSourceNode | null>
): Promise<void> {
  if (!audioCtxRef.current) return
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  const audioBuffer = await audioCtxRef.current.decodeAudioData(bytes.buffer.slice(0))
  const source = audioCtxRef.current.createBufferSource()
  source.buffer = audioBuffer

  if (analyserRef.current) {
    source.connect(analyserRef.current)
    analyserRef.current.connect(audioCtxRef.current.destination)
  } else {
    source.connect(audioCtxRef.current.destination)
  }

  currentAudioSourceRef.current = source

  return new Promise((resolve) => {
    source.onended = () => {
      if (currentAudioSourceRef.current === source) {
        currentAudioSourceRef.current = null
      }
      resolve()
    }
    source.start()
  })
}

function float32ToWav(samples: Float32Array, sampleRate = 16000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const write = (o: number, s: string) => s.split('').forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)))

  write(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  const pcm = new Int16Array(buffer, 44)
  for (let i = 0; i < samples.length; i++) {
    pcm[i] = Math.max(-1, Math.min(1, samples[i])) * 0x7fff
  }

  return new Blob([buffer], { type: 'audio/wav' })
}
