import { useVoiceStore } from '../store/voiceStore'

const stateLabel = {
  idle: 'Asleep',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  error: 'Needs attention',
}

export function PersonaView() {
  const convState = useVoiceStore((state) => state.convState)
  const interimText = useVoiceStore((state) => state.interimText)
  const aiName = useVoiceStore((state) => state.config.ai_name)

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className={`persona-orb persona-${convState}`} aria-label={`${aiName} is ${stateLabel[convState].toLowerCase()}`}>
        <div className="persona-core" />
        <div className="persona-ring persona-ring-one" />
        <div className="persona-ring persona-ring-two" />
      </div>
      <div className="min-h-[4.5rem] max-w-md px-4">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">{aiName}</p>
        {convState != 'idle' && <p className="mt-2 text-lg font-medium text-zinc-900 dark:text-zinc-50">{stateLabel[convState]}</p>}
        {interimText && convState === 'listening' && (
          <p className="mt-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{interimText}</p>
        )}
      </div>
    </div>
  )
}

