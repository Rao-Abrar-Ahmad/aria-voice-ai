import type { Ai } from '@cloudflare/workers-types'
import type { AiConfig, Message } from '../types'

export async function* runLLM(ai: Ai, history: Message[], config: AiConfig): AsyncGenerator<string, string> {
  const result = (await ai.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [{ role: 'system', content: config.system_prompt }, ...history],
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
  const result = (await ai.run('@cf/deepgram/aura-1', {
    text,
  })) as any

  return {
    data: typeof result === 'string' ? result : result?.audio ?? result?.body ?? result?.data ?? '',
    format: 'mp3',
  }
}
