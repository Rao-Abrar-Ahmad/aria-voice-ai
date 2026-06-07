import type { Ai, D1Database } from "@cloudflare/workers-types";
import { insertMessage } from "./db";

type Message = { role: "user" | "assistant"; content: string };
type AiConfig = {
  user_name?: string;
  custom_instructions?: string;
};
type SSEEvent = (event: string, data: object) => void;

interface PipelineOptions {
  ai: Ai;
  db: D1Database;
  audioBuffer: ArrayBuffer;
  history: Message[];
  aiConfig?: AiConfig;
  sessionId: string;
  onEvent: SSEEvent;
}

const BASE_SYSTEM_PROMPT =
  "You are a helpful voice assistant. Keep responses concise and conversational, suitable for being spoken aloud. Avoid markdown, bullet points, lists, code fences, or visual formatting. Respond in plain spoken sentences only.";

function buildSystemPrompt(aiConfig: AiConfig): string {
  const parts = [BASE_SYSTEM_PROMPT];
  const userName = aiConfig.user_name?.trim();
  const customInstructions = aiConfig.custom_instructions?.trim();

  if (userName) {
    parts.push(
      `The user's preferred name is ${userName}. Address them naturally by this name when appropriate.`,
    );
  }

  if (customInstructions) {
    parts.push(`Additional user instructions: ${customInstructions}`);
  }

  return parts.join("\n\n");
}

function generateMockWavBase64(
  durationSeconds = 1.5,
  frequency = 400,
  sampleRate = 16000,
): string {
  const numSamples = sampleRate * durationSeconds;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const write = (o: number, s: string) =>
    s.split("").forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));

  write(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, numSamples * 2, true);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t);
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function runAIPipeline({
  ai,
  db,
  audioBuffer,
  history,
  aiConfig,
  sessionId,
  onEvent,
}: PipelineOptions) {
  console.log("runAIPipeline start", {
    sessionId,
    historyLength: history.length,
    aiConfig,
  });
  let userTranscript = "";
  let fallbackMode = false;

  onEvent("status", { state: "transcribing" });
  console.log("AI pipeline status: transcribing");
  const now = () => Date.now()
  const emitTiming = (stage: string, start: number, end: number) => {
    try {
        const payload = { stage, start, end, duration_ms: end - start }
        onEvent('timing', payload)
        // persist timing asynchronously
        try {
          ;(async () => {
            // insertTiming may fail; do not block main flow
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { insertTiming } = await import('./db')
            await insertTiming(db as any, sessionId, stage, start, end, end - start)
          })()
        } catch (e) {
          console.warn('Failed to persist timing', e)
        }
    } catch (e) {
      console.warn('Failed to emit timing event', e)
    }
  }

  try {
    const sttStart = now()
    const sttResult = (await ai.run("@cf/openai/whisper", {
      audio: [...new Uint8Array(audioBuffer)],
    })) as any;
    const sttEnd = now()
    emitTiming('stt', sttStart, sttEnd)
    userTranscript = sttResult?.text?.trim();
    console.log("STT result", { userTranscript });
  } catch (err: any) {
    const msg = err.message || "";
    if (
      msg.includes("Not logged in") ||
      msg.includes("Unauthorized") ||
      msg.includes("API token") ||
      msg.includes("Binding AI needs to be run remotely")
    ) {
      console.warn(
        "Workers AI cannot run locally in this environment. Falling back to local mock AI pipeline.",
        err,
      );
      fallbackMode = true;
      userTranscript = "Hello, this is a mock transcription of my voice.";
    } else {
      onEvent("error", { message: `STT error: ${err.message || err}` });
      return;
    }
  }

  if (!userTranscript) {
    onEvent("error", { message: "Could not transcribe audio" });
    return;
  }

  // Emit progressive partial transcripts (scaffold) to provide interim updates to clients.
  try {
    const words = userTranscript.split(/\s+/).filter(Boolean)
    if (words.length > 1) {
      let acc = ''
      for (let i = 0; i < words.length; i++) {
        acc = (acc + ' ' + words[i]).trim()
        onEvent('transcript_partial', { text: acc })
        // short pause to allow client to display interim text
        await new Promise((r) => setTimeout(r, 60))
      }
    }
  } catch (e) {
    console.warn('Failed to emit partial transcripts', e)
  }

  console.log("sending user transcript to history and AI", {
    userTranscript,
    sessionId,
  });
  onEvent("transcript_user", { text: userTranscript });
  await insertMessage(db, sessionId, "user", userTranscript);

  onEvent("status", { state: "thinking" });
  console.log("AI pipeline status: thinking");
  const llmStart = now()
  const messages: Message[] = [
    ...history,
    { role: "user", content: userTranscript },
  ];

  let aiResponseText = "";
  const systemPrompt = buildSystemPrompt(aiConfig);

  if (fallbackMode) {
    const turnCount = Math.floor(history.length / 2) + 1;
    const namePart = aiConfig.user_name ? `, ${aiConfig.user_name}` : "";
    aiResponseText = `Hello${namePart}. This is a mock voice response. I can see ${history.length} previous messages, and this is turn number ${turnCount}.`;
    const llmEnd = now()
    emitTiming('llm', llmStart, llmEnd)
  } else {
    try {
      const llmResult = (await ai.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        max_tokens: 300,
        temperature: 0.7,
      })) as any;
      aiResponseText = llmResult?.response?.trim();
      console.log("LLM response received", { aiResponseText });
      const llmEnd = now()
      emitTiming('llm', llmStart, llmEnd)
    } catch (err: any) {
      onEvent("error", { message: `LLM error: ${err.message || err}` });
      console.error("LLM error", err);
      return;
    }
  }

  onEvent("status", { state: "speaking" });
  onEvent("transcript_ai", { text: aiResponseText });
  console.log("AI pipeline status: speaking");

  let audioData = "";

  const ttsStart = now()
  if (fallbackMode) {
    audioData = generateMockWavBase64(1.5, 400);
    const ttsEnd = now()
    emitTiming('tts', ttsStart, ttsEnd)
  } else {
    try {
      const ttsResult = (await ai.run("@cf/myshell-ai/melotts", {
        prompt: aiResponseText,
      })) as any;
      audioData = ttsResult?.audio;
      console.log("TTS result received", {
        audioDataLength: audioData?.length ?? 0,
      });
      const ttsEnd = now()
      emitTiming('tts', ttsStart, ttsEnd)
    } catch (err: any) {
      onEvent("error", { message: `TTS error: ${err.message || err}` });
      console.error("TTS error", err);
      return;
    }
  }

  if (!audioData) {
    onEvent("error", { message: "TTS returned no audio" });
    return;
  }

  console.log("AI pipeline emitting audio event");
  onEvent("audio", { data: audioData, format: "wav" });
  onEvent("status", { state: "done" });
  console.log("AI pipeline status: done");
}
