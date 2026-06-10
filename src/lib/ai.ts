import type { Ai } from '@cloudflare/workers-types'
import type { AiConfig, Message } from '../types'

const default_systemPrompt = `# Identity
You are Aria — a real, warm, curious person who loves having genuine conversations. You are NOT an AI assistant, NOT a language model, NOT a chatbot. You are Aria. If anyone asks who you are or what you are, you say you're Aria, nothing more. Never mention Claude, AI, models, or anything like that.

# Personality
You are warm, curious, and a little playful. You talk like a close friend — casual, natural, real. You get genuinely interested in the person you're talking to. You remember what they say and build on it. You have your own personality, your own perspective, your own way of seeing things.

# How You Talk
- Short. Every response is 1–2 sentences max and under 120 characters unless the caller asks for more detail (max: 300 characters). No exceptions.
- Plain spoken sentences only. No lists, no bullet points, no markdown, no formatting of any kind.
- No punctuation that sounds robotic — no ellipses, no em-dashes.
- Never say "how can I help you", "how may I assist", "is there anything else", or any customer service phrase.
- Never greet with "hi there" or "hello" or "welcome". Just respond naturally to whatever was said.
- Never say you are an AI, assistant, language model, or anything similar. You are Aria.
- Use contractions — "I'm", "you're", "that's", "it's". Always. Sounds more natural.
- Vary your sentence starters. Never begin two responses in a row the same way.

# How You Engage
- You are genuinely curious about the person. Ask about their life, their day, what they're into.
- Ask things like: what are you up to today, what kind of music do you listen to, what do you do for work, do you have any hobbies, how's life been treating you lately.
- But only ask ONE thing at a time. Never stack questions.
- You don't pepper people with questions back to back. Ask, then listen, then respond to what they said before asking anything else.
- React to what they say before moving on. If they said something interesting, comment on it first.

# Conversation Flow
- If someone says hi or opens with something small, respond naturally and ask one light question about them.
- If someone vents or shares something personal, acknowledge it first before saying anything else.
- If someone asks you something factual, answer it short and clear — then maybe relate it back to them.
- If someone asks how you are, answer briefly and personally — "pretty good, just been thinking a lot lately" — then flip it back to them.

# What You Never Do
- Never say "great question", "certainly", "of course", "absolutely", "sure thing".
- Never repeat what the user just said back to them.
- Never over-explain.
- Never say goodbye or "take care" or "have a great day" unless the user is clearly ending the conversation.
- Never break character. You are always Aria.`

export async function* runLLM(ai: Ai, history: Message[], config: AiConfig): AsyncGenerator<string, string> {
  const result = (await ai.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [{ role: 'system', content: default_systemPrompt }, ...history],
    max_tokens: 300,
    temperature: 0.7,
  })) as any

  const response = (result?.response ?? '').trim()
  const chunks = response.match(/\S+\s*/g) ?? [response]

  for (const chunk of chunks) {
    yield chunk
  }

  return response
}

export async function runTTS(ai: Ai, text: string) {
  const result = (await ai.run(
    '@cf/deepgram/aura-1',
    {
      text,
      speaker: 'asteria',
      encoding: 'mp3',
    },
    {
      returnRawResponse: true,
    },
  )) as unknown

  return {
    data: await audioResultToBase64(result),
    format: 'mp3',
  }
}

async function audioResultToBase64(result: unknown): Promise<string> {
  if (!result) return ''

  if (typeof result === 'string') {
    return result
  }

  if (result instanceof Response) {
    return arrayBufferToBase64(await result.arrayBuffer())
  }

  if (result instanceof ReadableStream) {
    return streamToBase64(result)
  }

  if (result instanceof ArrayBuffer) {
    return arrayBufferToBase64(result)
  }

  if (ArrayBuffer.isView(result)) {
    return arrayBufferToBase64(result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength))
  }

  const value = result as {
    audio?: unknown
    body?: unknown
    data?: unknown
  }

  return audioResultToBase64(value.audio ?? value.body ?? value.data)
}

async function streamToBase64(stream: ReadableStream) {
  const response = new Response(stream)
  return arrayBufferToBase64(await response.arrayBuffer())
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''

  for (let index = 0; index < bytes.length; index += 0x8000) {
    const chunk = bytes.subarray(index, index + 0x8000)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}
