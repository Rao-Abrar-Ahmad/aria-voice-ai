import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { sessionRoute } from './routes/session'
import { turnRoute } from './routes/turn'
import { configRoute } from './routes/config'
import { historyRoute } from './routes/history'
import type { Env } from './types'

const app = new Hono<{ Bindings: Env }>()

// CORS is only needed during local dev (Vite on :5173, Worker on :8787)
// In production, frontend and API are same origin — no CORS required
app.use('/api/*', cors({
  origin: ['http://localhost:5173'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}))

app.route('/api/session', sessionRoute)
app.route('/api/turn', turnRoute)
app.route('/api/config', configRoute)
app.route('/api/history', historyRoute)

export default app
