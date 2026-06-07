## Plan: Improve VAD Accuracy, Latency, and Streaming UX

TL;DR: Fix inaccurate and slow voice detection/transcription by improving frontend VAD accuracy, adding low-latency streaming via WebSocket for progressive transcription and audio streaming, and instrumenting timing and incremental transcript updates into the conversation history sidebar.

**Steps**
1. Diagnose and improve VAD accuracy (*short discovery, 1-2 days*).
   - Collect logs and sample audio: add debug dumping of detected speech segments and a way to download raw audio clips for failed cases.
   - Tune `MicVAD` configuration (model: legacy vs v5, frame sizes, thresholds) and test different resampling/normalization strategies.
   - Validate results against ground-truth samples and iterate until false positives/negatives drop materially.

2. Replace/augment endpointing with lightweight fallback (parallel with step 1).
   - Implement an energy-based silence detector as a fallback to the model-based VAD for short utterances or noisy environments.
   - Keep model-based VAD for higher-quality detection when assets and performance permit.

3. Add low-latency streaming with WebSocket (blocking on backend change).
   - Design a WebSocket protocol: client streams small PCM chunks (e.g., 320ms) encoded as base64 frames; server acknowledges receipt and optionally returns partial STT results.
   - Implement a WebSocket handler in the Worker (`/ws/turn`) using WebSocketPair and `runAIPipeline` adaptions to accept streaming audio and emit partial events (`transcript_partial`, `status`, `audio_chunk`).
   - Update client to open a persistent socket per session and stream audio frames during a turn, handling reconnection and backpressure.

4. Progressive transcription & UI streaming.
   - Stream partial transcripts into the conversation sidebar as `transcript_partial` events; convert to `transcript_user` when the segment is finalized.
   - Update `TranscriptPanel` to render interim text in a muted style and finalize when the server marks it complete.

5. Add timers, tracing, and metrics.
   - Add client-side timers around: audio capture → first STT token, STT complete, LLM first token, TTS start, audio end. Send these telemetry events to the backend or log them in the Worker logs.
   - Add server-side timing in `runAIPipeline` and the WebSocket handler to record per-stage durations and emit them as `timing` events to the client.
   - Store timing logs optionally in D1 or send to an observability endpoint for later analysis.

6. Resiliency & fallbacks.
   - Keep current SSE endpoint as a fallback when WebSocket is unavailable; maintain mock/fallback mode logic for local dev.
   - Add explicit feature detection and a config toggle to enable/disable WebSocket streaming at runtime.

7. Testing & rollout.
   - Unit tests for chunking, encoding/decoding, and timing instrumentation.
   - End-to-end tests with recorded audio to validate transcript correctness and latency improvements.
   - Canary deploy the WebSocket handler and opt-in users for initial telemetry collection.

**Relevant files to modify**
- `client/src/hooks/useVAD.ts` — tuning, debug dump hooks, fallback endpointing.
- `client/src/hooks/useSSE.ts` → add `client/src/hooks/useWS.ts` — client WebSocket streaming implementation.
- `client/src/App.tsx` — wire up WebSocket lifecycle, timers, and partial transcript handling.
- `client/src/components/TranscriptPanel.tsx` — render interim transcripts and finalize messages.
- `src/routes/turn.ts` — keep SSE fallback; add WebSocket route `/ws/turn` to accept streaming audio and emit partial events.
- `src/lib/ai.ts` — adapt `runAIPipeline` to support incremental audio input and emit `transcript_partial` and `timing` events.
- `src/lib/db.ts` — optionally persist timing/telemetry to D1 (opt-in).

**Verification**
1. Latency: measure median time from audio chunk sent → first partial transcript token, and from final chunk → `transcript_ai` start. Target: reduce end-to-end latency by >=50% vs current.
2. Accuracy: compare transcripts for a test corpus before and after tuning; track Word Error Rate (WER) or a simpler token-accuracy metric.
3. UI: partial transcripts appear progressively in the sidebar and finalize correctly; audio playback for assistant is not blocked by full pipeline completion.
4. Observability: timing events appear in Worker logs and (if enabled) persisted store for analysis.

**Decisions & assumptions**
- WebSocket streaming will provide lower latency and allow partial STT/APIs to return interim results; Cloudflare Workers supports WebSocketPair and can be used for this.
- Keep SSE as a fallback to avoid breaking current clients.
- We will not replace the backend LLM or STT provider in this plan; instead we will stream audio to the existing Workers AI endpoints or adapt to a streaming-capable STT binding if available.

**Further considerations**
1. Audio chunking: use fixed-size PCM frames (e.g., 16000 Hz, 320 ms) and avoid excessive base64 overhead by batching binary frames where possible.
2. Security: authenticate sockets using session/guest tokens; ensure rate limits and quotas are enforced server-side.
3. Cost: streaming STT/LLM may increase API usage—add sampling or quotas for canary phase.
4. UX: show a small timing/health indicator in the UI when using WebSocket streaming and allow users to opt out.

