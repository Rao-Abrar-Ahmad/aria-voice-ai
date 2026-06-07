import { useEffect, useRef } from 'react'

export type TranscriptMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  interim?: boolean
  duration_ms?: number
  stage_timings?: Record<string, number>
}

interface Props {
  messages: TranscriptMessage[]
  assistantName: string
}

export function TranscriptPanel({ messages, assistantName }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex flex-col gap-4 overflow-y-auto h-full p-4">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex flex-col gap-1 ${
            msg.role === 'user' ? 'items-end' : 'items-start'
          }`}
        >
          <span className="text-[10px] font-semibold tracking-wider uppercase text-gray-400 dark:text-gray-500 px-1.5">
            {msg.role === 'user' ? 'You' : assistantName}
          </span>
          <div
            className={`px-4 py-3 rounded-2xl max-w-[85%] text-sm leading-relaxed ${
              msg.role === 'user'
                ? msg.interim
                  ? 'bg-indigo-100 text-indigo-800/90 italic rounded-tr-none opacity-80'
                  : 'bg-indigo-600 text-white rounded-tr-none shadow-md shadow-indigo-600/10'
                : msg.interim
                ? 'bg-gray-100 dark:bg-gray-900 text-gray-500 italic rounded-tl-none border border-gray-200/30'
                : 'bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-100 rounded-tl-none border border-gray-200/50 dark:border-gray-800/50'
            }`}
          >
            {msg.text}
          </div>
          {msg.role === 'assistant' && !msg.interim && (
            <div className="mt-1 text-zinc-500 dark:text-zinc-400 text-[11px]">
              {msg.duration_ms !== undefined && <div className="mb-1">Total: {msg.duration_ms}ms</div>}
              {msg.stage_timings && (
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(msg.stage_timings).map(([k, v]) => (
                    <div key={k} className="px-2 py-1 bg-zinc-50 dark:bg-zinc-800 rounded-md border border-zinc-100 dark:border-zinc-700 text-[11px]">
                      <div className="font-semibold text-[10px] text-zinc-600 dark:text-zinc-300">{k}</div>
                      <div className="font-mono text-xs">{v}ms</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
