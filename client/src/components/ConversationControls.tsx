import { PanelLeft, Settings, Square } from 'lucide-react'
import { useVoiceStore } from '../store/voiceStore'

type Props = {
  onEnd: () => void
  onSettingsOpen: () => void
}

export function ConversationControls({ onEnd, onSettingsOpen }: Props) {
  const showTranscript = useVoiceStore((state) => state.showTranscript)
  const setShowTranscript = useVoiceStore((state) => state.setShowTranscript)
  const convState = useVoiceStore((state) => state.convState)

  return (
    <div className="flex items-center justify-center gap-3">
      <button
        type="button"
        onClick={() => setShowTranscript(!showTranscript)}
        className="hidden sm:inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 shadow-sm transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        title="Toggle transcript"
      >
        <PanelLeft size={18} />
      </button>
      {/* <button
        type="button"
        onClick={onSettingsOpen}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 shadow-sm transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        title="Settings"
      >
        <Settings size={18} />
      </button> */}
      <div className="flex h-11 min-w-32 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
        {convState === 'idle' ? 'Ready' : convState}
      </div>
      <button
        type="button"
        onClick={onEnd}
        className="inline-flex h-11 items-center gap-2 rounded-full border border-red-200 bg-red-50 px-5 text-sm font-semibold text-red-600 transition hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
      >
        <Square size={14} fill="currentColor" />
        End
      </button>
    </div>
  )
}

