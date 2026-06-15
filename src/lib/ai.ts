import type { Ai } from '@cloudflare/workers-types'
import type { AiConfig, Message } from '../types'
import { chatgpt_ai_system_prompt } from './example-system-prompts'

const default_systemPrompt = chatgpt_ai_system_prompt;

export async function* runLLM(ai: Ai, history: Message[], config: AiConfig): AsyncGenerator<string, string> {
  const result = (await ai.run('@cf/qwen/qwen3-30b-a3b-fp8', {
    messages: [{ role: 'system', content: default_systemPrompt }, ...history],
    max_tokens: 300,
    temperature: 0.7
  })) as any;

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
