# Aria AI - Edge-Native Voice Assistant

Aria AI is a warm, ultra-low-latency, serverless voice assistant running entirely on the Cloudflare global network. It leverages a modern "sandwich architecture" to process Speech-to-Text (STT) locally on the client, coordinate stateful WebSocket connections via Durable Objects, and generate real-time LLM responses and Text-to-Speech (TTS) voice synthesis at the edge.

🌐 **Demo Domain:** [aria-ai.codebyrsa.com](https://aria-ai.codebyrsa.com)

---

## 🥪 Sandwich Architecture

Aria uses a hybrid client-edge model to minimize latency, avoid expensive server-side audio processing egress costs, and provide a responsive conversation loop.

```
[User Speaks]
     │
     ▼
Browser Web Speech API (Native STT)
  ├─ interimTranscript  ──► UI: Live streaming text
  └─ finalTranscript    ──► WebSocket: Send { type: "transcript", text }
     │
     ▼
Cloudflare Durable Object (WebSocket Session)
  ├─ Emits status: "thinking"
  ▼
Cloudflare Workers AI (@cf/meta/llama-3.1-8b-instruct or Qwen)
  ├─ System prompt applied + DB history (D1) injected
  ├─ Streams LLM text response
  ▼
Cloudflare Workers AI (@cf/deepgram/aura-1)
  ├─ Emits status: "speaking"
  └─ Emits base64 audio ──► Browser Audio Playback
     │
     ▼
Audio Playback Ends
  └─ Emits status: "idle" ──► Resume listening loop
```

---

## 🛠️ Technology Stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, shadcn/ui, `react-speech-recognition`
- **Backend:** Hono, Cloudflare Workers, Durable Objects (WebSockets + Hibernation API)
- **Database:** Cloudflare D1 (SQLite at the edge for session & message history persistence)
- **AI Models:** 
  - LLM: `@cf/meta/llama-3.1-8b-instruct` or `@cf/qwen/qwen3-30b-a3b-fp8`
  - TTS: `@cf/deepgram/aura-1` (Voice: `aura-asteria-en`)

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- Cloudflare Wrangler CLI (installed automatically via devDependencies)
- A Cloudflare account with D1 and Workers AI enabled

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/aria-voice-ai.git
   cd aria-voice-ai
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Database Setup

Initialize your local D1 database:
```bash
npm run db:migrate:local
```

For production deployment, create a database and run the migrations:
```bash
npx wrangler d1 create voice-ai-db
# Copy the database_id from the output into your wrangler.jsonc file
npm run db:migrate:remote
```

### Local Development

1. Run the greeting generator script to create the initial welcome audio file:
   ```bash
   npm run generate:greeting
   ```

2. Start the development server (runs both Vite frontend and Wrangler Worker dev server concurrently):
   ```bash
   npm run dev
   ```
   Open your browser at `http://localhost:5173`.

---

## 🌐 Deployment

Deploy the application to Cloudflare Workers and Assets:
```bash
npm run deploy
```

> [!IMPORTANT]
> Make sure to set a secure `COOKIE_SECRET` environment variable on your deployed Worker:
> ```bash
> npx wrangler secret put COOKIE_SECRET
> ```

---

## 🤝 Contributing

Contributions are welcome! Please feel free to open a Pull Request or report bugs.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
