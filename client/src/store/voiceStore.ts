import { create } from 'zustand'
import type { AiConfig, ConvState, TranscriptMessage } from '../types'

type VoiceStore = {
  convState: ConvState
  active: boolean
  sessionId: string
  userId: string
  interimText: string
  messages: TranscriptMessage[]
  config: AiConfig
  showTranscript: boolean
  wsConnected: boolean
  error: string
  setConvState: (state: ConvState) => void
  setActive: (active: boolean) => void
  setSession: (sessionId: string, userId: string) => void
  setInterimText: (text: string) => void
  setMessages: (messages: TranscriptMessage[]) => void
  addMessage: (message: TranscriptMessage) => void
  appendAssistantChunk: (text: string) => void
  setConfig: (config: AiConfig) => void
  setShowTranscript: (show: boolean) => void
  setWsConnected: (connected: boolean) => void
  setError: (error: string) => void
  resetConversation: () => void
}

export const useVoiceStore = create<VoiceStore>((set) => ({
  convState: 'idle',
  active: false,
  sessionId: '',
  userId: '',
  interimText: '',
  messages: [],
  config: {
    ai_name: 'Aria',
    system_prompt:
      'You are Aria, a warm and intelligent voice assistant. You speak in a natural, conversational tone - as if talking to a friend. Keep responses concise: 1-3 sentences unless more detail is genuinely needed. Never use markdown, bullet points, headers, or lists. Respond in plain flowing sentences only, since your words will be spoken aloud.',
  },
  showTranscript: false,
  wsConnected: false,
  error: '',
  setConvState: (convState) => set({ convState }),
  setActive: (active) => set({ active }),
  setSession: (sessionId, userId) => set({ sessionId, userId }),
  setInterimText: (interimText) => set({ interimText }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  appendAssistantChunk: (text) =>
    set((state) => {
      const last = state.messages[state.messages.length - 1]
      if (last?.role === 'assistant' && last.streaming) {
        return {
          messages: [
            ...state.messages.slice(0, -1),
            { ...last, content: `${last.content}${text}` },
          ],
        }
      }

      return {
        messages: [
          ...state.messages,
          { id: crypto.randomUUID(), role: 'assistant', content: text, streaming: true },
        ],
      }
    }),
  setConfig: (config) => set({ config }),
  setShowTranscript: (showTranscript) => set({ showTranscript }),
  setWsConnected: (wsConnected) => set({ wsConnected }),
  setError: (error) => set({ error }),
  resetConversation: () => set({ convState: 'idle', active: false, interimText: '', error: '' }),
}))

