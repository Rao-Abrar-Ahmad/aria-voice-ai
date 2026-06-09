export type ConvState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

export type TranscriptMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

export type AiConfig = {
  ai_name: string
  system_prompt: string
}

export type SessionResponse = {
  session_id: string
  user_id: string
  is_new_user: boolean
}

