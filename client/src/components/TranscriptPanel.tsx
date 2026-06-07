import { useEffect, useRef } from 'react'

export type TranscriptMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
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
                ? 'bg-indigo-600 text-white rounded-tr-none shadow-md shadow-indigo-600/10'
                : 'bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-100 rounded-tl-none border border-gray-200/50 dark:border-gray-800/50'
            }`}
          >
            {msg.text}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
