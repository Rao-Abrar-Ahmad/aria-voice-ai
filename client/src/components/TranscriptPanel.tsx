import { useEffect, useRef } from 'react'
import { useVoiceStore } from '../store/voiceStore'

export function TranscriptPanel() {
  const messages = useVoiceStore((state) => state.messages)
  const aiName = useVoiceStore((state) => state.config.ai_name)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Conversation</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">Start talking to begin...</p>
        )}
        <div className="flex flex-col gap-4">
          {messages.map((message) => (
            <div key={message.id} className={`flex flex-col gap-1 ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
              <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                {message.role === 'user' ? 'You' : aiName}
              </span>
              <div
                className={`max-w-[88%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
                  message.role === 'user'
                    ? 'bg-teal-600 text-white'
                    : 'border border-zinc-200 bg-white text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100'
                }`}
              >
                {message.content || <span className="animate-pulse text-zinc-400">Thinking...</span>}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
}
