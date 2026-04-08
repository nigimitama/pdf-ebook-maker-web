/**
 * LLMクライアント
 *
 * 対応プロバイダー:
 *   - OpenAI API (GPT-4o-mini など)
 *   - Anthropic API (Claude Haiku など)
 *   - Ollama (ローカルCPU LLM: localhost:11434)
 *   - カスタム OpenAI 互換エンドポイント (LM Studio など)
 *
 * ブラウザから直接 API を呼び出す。
 * Ollama / LM Studio はローカルで動くため API キー不要。
 */

import type { LLMSettings, LLMProvider } from '../types/ocr'

/** OCRテキスト校正用デフォルトシステムプロンプト */
export const DEFAULT_SYSTEM_PROMPT = `あなたはOCR（光学文字認識）テキストの校正専門家です。
以下のルールに従って、OCRで読み取ったテキストを校正してください：

1. 明らかな誤認識（文脈上おかしい文字・単語）のみを修正する
2. 元の文章の構造・段落・改行は保持する
3. 不明瞭な部分は推測で補完せず、元のままにする
4. 校正済みテキストのみを返し、説明や注釈は一切含めない

テキスト言語: 主に日本語（漢字・ひらがな・カタカナ混在）`

export interface LLMRequestOptions {
  onChunk?: (chunk: string) => void
  signal?: AbortSignal
}

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  ollama: 'qwen2.5:1.5b',
  custom: 'gpt-4o-mini',
}

export function getDefaultModel(provider: LLMProvider): string {
  return DEFAULT_MODELS[provider]
}

/**
 * テキストを校正する
 * @returns 校正済みテキスト
 */
export async function correctText(
  text: string,
  settings: LLMSettings,
  options?: LLMRequestOptions
): Promise<string> {
  const userMessage = `以下のOCRテキストを校正してください：\n\n${text}`

  switch (settings.provider) {
    case 'openai':
    case 'custom':
      return callOpenAICompatible(userMessage, settings, options)
    case 'anthropic':
      return callAnthropic(userMessage, settings, options)
    case 'ollama':
      return callOllama(userMessage, settings, options)
    default:
      throw new Error(`未対応のプロバイダー: ${settings.provider}`)
  }
}

// ---- OpenAI / カスタム OpenAI 互換 ----

async function callOpenAICompatible(
  userMessage: string,
  settings: LLMSettings,
  options?: LLMRequestOptions
): Promise<string> {
  const baseUrl = settings.provider === 'openai'
    ? 'https://api.openai.com/v1'
    : settings.baseUrl.replace(/\/$/, '')

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (settings.apiKey) {
    headers['Authorization'] = `Bearer ${settings.apiKey}`
  }

  const useStream = !!options?.onChunk

  const body = {
    model: settings.model || getDefaultModel(settings.provider),
    messages: [
      { role: 'system', content: settings.systemPrompt || DEFAULT_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    stream: useStream,
    temperature: 0.1,
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options?.signal,
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => res.statusText)
    throw new Error(`LLM API エラー (${res.status}): ${errorText}`)
  }

  if (useStream) {
    return readOpenAIStream(res, options.onChunk!)
  } else {
    const json = await res.json()
    return json.choices?.[0]?.message?.content ?? ''
  }
}

async function readOpenAIStream(
  res: Response,
  onChunk: (chunk: string) => void
): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const lines = decoder.decode(value).split('\n')
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue

      try {
        const json = JSON.parse(data)
        const chunk = json.choices?.[0]?.delta?.content ?? ''
        if (chunk) {
          fullText += chunk
          onChunk(chunk)
        }
      } catch {
        // パース失敗は無視
      }
    }
  }

  return fullText
}

// ---- Anthropic ----

async function callAnthropic(
  userMessage: string,
  settings: LLMSettings,
  options?: LLMRequestOptions
): Promise<string> {
  const useStream = !!options?.onChunk

  const body = {
    model: settings.model || getDefaultModel('anthropic'),
    max_tokens: 4096,
    system: settings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    stream: useStream,
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
    signal: options?.signal,
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => res.statusText)
    throw new Error(`Anthropic API エラー (${res.status}): ${errorText}`)
  }

  if (useStream) {
    return readAnthropicStream(res, options.onChunk!)
  } else {
    const json = await res.json()
    return json.content?.[0]?.text ?? ''
  }
}

async function readAnthropicStream(
  res: Response,
  onChunk: (chunk: string) => void
): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const lines = decoder.decode(value).split('\n')
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()

      try {
        const json = JSON.parse(data)
        if (json.type === 'content_block_delta' && json.delta?.text) {
          fullText += json.delta.text
          onChunk(json.delta.text)
        }
      } catch {
        // ignore
      }
    }
  }

  return fullText
}

// ---- Ollama ----

async function callOllama(
  userMessage: string,
  settings: LLMSettings,
  options?: LLMRequestOptions
): Promise<string> {
  const baseUrl = settings.baseUrl || 'http://localhost:11434'
  const model = settings.model || getDefaultModel('ollama')
  const useStream = !!options?.onChunk

  const body = {
    model,
    messages: [
      { role: 'system', content: settings.systemPrompt || DEFAULT_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    stream: useStream,
    options: { temperature: 0.1 },
  }

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options?.signal,
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => res.statusText)
    throw new Error(`Ollama API エラー (${res.status}): ${errorText}`)
  }

  if (useStream) {
    return readOllamaStream(res, options.onChunk!)
  } else {
    const json = await res.json()
    return json.message?.content ?? ''
  }
}

async function readOllamaStream(
  res: Response,
  onChunk: (chunk: string) => void
): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const lines = decoder.decode(value).split('\n').filter(l => l.trim())
    for (const line of lines) {
      try {
        const json = JSON.parse(line)
        const chunk = json.message?.content ?? ''
        if (chunk) {
          fullText += chunk
          onChunk(chunk)
        }
      } catch {
        // ignore
      }
    }
  }

  return fullText
}

/** LLM 接続テスト */
export async function testConnection(settings: LLMSettings): Promise<boolean> {
  try {
    const result = await correctText('テスト', settings, { onChunk: undefined })
    return result.length >= 0
  } catch {
    return false
  }
}
