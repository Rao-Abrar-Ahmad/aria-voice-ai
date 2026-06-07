import type { D1Database, Ai } from '@cloudflare/workers-types'

export type Env = {
  DB: D1Database
  AI: Ai
  ASSETS: Fetcher        // Workers Assets binding
  ENVIRONMENT: string
}
