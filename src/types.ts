import type { D1Database, Ai } from '@cloudflare/workers-types'

export type Env = {
  DB: D1Database
  AI: Ai
  ASSETS: Fetcher        // Workers Assets binding
  VOICE_SESSION: DurableObjectNamespace
  ENVIRONMENT: string
  COOKIE_SECRET: string
}

export type Message = {
  role: 'user' | 'assistant'
  content: string
}

export type AiConfig = {
  ai_name: string
  system_prompt: string
}

export type User = {
  id: string
  email: string | null
  guest_id: string
  created_at: string
}

export type Session = {
  id: string
  user_id: string
  created_at: string
}
