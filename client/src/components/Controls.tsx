import { Mic, Square } from 'lucide-react'

type ConvState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

interface Props {
  state: ConvState
  onStart: () => void
  onStop: () => void
}

export function Controls({ state, onStart, onStop }: Props) {
  const isActive = state !== 'idle'
  const isProcessing = ['transcribing', 'thinking', 'speaking'].includes(state)

  const statusLabel: Record<ConvState, string> = {
    idle: '',
    listening: 'Listening',
    transcribing: 'Transcribing...',
    thinking: 'Thinking...',
    speaking: 'Speaking...',
  }

  return (
    <div className="flex items-center justify-center gap-4">
      {!isActive ? (
        <button
          onClick={onStart}
          className="flex items-center gap-2 px-6 py-3.5 rounded-full bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition shadow-lg shadow-indigo-600/20 active:scale-95"
        >
          <Mic size={18} />
          Start talking
        </button>
      ) : (
        <>
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-gray-100 dark:bg-gray-900 text-sm text-gray-600 dark:text-gray-400 border border-gray-200/50 dark:border-gray-800">
            <span className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-emerald-500' : 'bg-indigo-500'} animate-pulse`} />
            {statusLabel[state]}
          </div>
          <button
            onClick={onStop}
            className="flex items-center gap-2 px-5 py-3 rounded-full bg-red-100 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-950/50 transition active:scale-95 border border-red-200/20"
          >
            <Square size={14} fill="currentColor" />
            End
          </button>
        </>
      )}
    </div>
  )
}
