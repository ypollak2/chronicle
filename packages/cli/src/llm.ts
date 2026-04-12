import { execSync, spawnSync } from 'child_process'
import type { LLMProvider } from '@chronicle/core'
import { debug } from './debug.js'

// ── HTTP retry with exponential backoff ──────────────────────────────────────
// Retries on 429 (rate limit) and 5xx (server errors). Respects Retry-After header.
// Network failures (fetch throws) are also retried with the same policy.

const MAX_RETRIES = 3
const BASE_DELAY_MS = 1_000

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  const host = new URL(url).hostname
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1)  // 1s, 2s, 4s
      debug('llm', `retry attempt ${attempt}/${retries} for ${host} (delay ${delay}ms)`)
      await new Promise(r => setTimeout(r, delay))
    }
    let res: Response
    try {
      debug('llm', `fetch ${host} attempt ${attempt + 1}`)
      res = await fetch(url, init)
    } catch (err) {
      // Network-level failure (DNS, connection refused, etc.)
      debug('llm', `network error on ${host}`, String(err))
      lastError = err
      continue
    }
    debug('llm', `response from ${host}: ${res.status}`)
    if (res.ok) return res
    // Don't retry on client errors (except 429)
    if (res.status !== 429 && res.status < 500) return res

    // Honour Retry-After header if present
    const retryAfter = res.headers.get('Retry-After')
    if (retryAfter && attempt < retries) {
      const wait = Number(retryAfter) * 1000 || BASE_DELAY_MS * 2 ** attempt
      debug('llm', `rate-limited by ${host}, waiting ${wait}ms (Retry-After: ${retryAfter})`)
      await new Promise(r => setTimeout(r, wait))
    }
    lastError = res
  }
  if (lastError instanceof Response) return lastError
  throw lastError
}

// Auto-detect best available provider if none specified
export function detectProvider(): string {
  // Prefer subscription CLIs over API keys — no cost, no key management
  try { execSync('claude --version', { stdio: 'ignore' }); return 'claude-code' } catch { /* not available */ }
  if (process.env.GEMINI_API_KEY) return 'gemini'
  if (process.env.OPENAI_API_KEY) return 'openai'
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic'
  try { execSync('codex --version', { stdio: 'ignore' }); return 'codex' } catch { /* not available */ }
  throw new Error(
    'No LLM provider found. Options:\n' +
    '  • Use Claude Code subscription: already available if running inside Claude Code\n' +
    '  • Set GEMINI_API_KEY for Gemini 2.5 Flash (free tier available)\n' +
    '  • Set OPENAI_API_KEY for GPT-4o-mini\n' +
    '  • Run Ollama locally: ollama pull qwen2.5:1.5b'
  )
}

// Thin adapter — each provider speaks to the same LLMProvider interface
export function makeLLMProvider(name: string): LLMProvider {
  const resolved = name === 'auto' ? detectProvider() : name
  switch (resolved) {
    case 'anthropic':   return makeAnthropicProvider()
    case 'openai':      return makeOpenAIProvider()
    case 'gemini':      return makeGeminiProvider()
    case 'ollama':      return makeOllamaProvider()
    case 'claude-code': return makeClaudeCodeProvider()
    case 'codex':       return makeCodexProvider()
    default: throw new Error(`Unknown LLM provider: ${resolved}. Options: anthropic|openai|gemini|ollama|claude-code|codex|auto`)
  }
}

function makeAnthropicProvider(): LLMProvider {
  return async (prompt) => {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',  // cheap, fast — right for extraction
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`)
    const data = await res.json() as { content: Array<{ text: string }> }
    return data.content[0].text
  }
}

function makeOpenAIProvider(): LLMProvider {
  return async (prompt) => {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY not set')

    const res = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4096,
      }),
    })

    if (!res.ok) throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`)
    const data = await res.json() as { choices: Array<{ message: { content: string } }> }
    return data.choices[0].message.content
  }
}

function makeOllamaProvider(): LLMProvider {
  return async (prompt) => {
    const model = process.env.OLLAMA_MODEL ?? 'qwen2.5:1.5b'
    const host  = process.env.OLLAMA_HOST  ?? 'http://localhost:11434'

    const res = await fetchWithRetry(`${host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) throw new Error(`Ollama error: ${res.status} ${await res.text()}`)
    const data = await res.json() as { message: { content: string } }
    return data.message.content
  }
}

// Uses the Claude Code CLI subscription — no API key needed
// Requires: claude CLI installed and authenticated (claude.ai/download)
// Prompt is passed via stdin — safe for large git diffs, no shell escaping issues
function makeClaudeCodeProvider(): LLMProvider {
  try { execSync('claude --version', { stdio: 'ignore' }) }
  catch { throw new Error('claude CLI not found. Install from claude.ai/download') }

  return async (prompt) => {
    const result = spawnSync('claude', ['-p', '-', '--output-format', 'text'], {
      input: prompt,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`claude CLI failed: ${result.stderr?.trim()}`)
    return result.stdout.trim()
  }
}

// Uses the OpenAI Codex CLI — no API key needed if authenticated
// Requires: codex CLI installed (npm install -g @openai/codex)
function makeCodexProvider(): LLMProvider {
  try { execSync('codex --version', { stdio: 'ignore' }) }
  catch { throw new Error('codex CLI not found. Install: npm install -g @openai/codex') }

  return async (prompt) => {
    const result = spawnSync('codex', ['exec', '--full-auto', '-'], {
      input: prompt,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`codex CLI failed: ${result.stderr?.trim()}`)
    return result.stdout.trim()
  }
}

function makeGeminiProvider(): LLMProvider {
  return async (prompt) => {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('GEMINI_API_KEY not set')

    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // thinkingBudget: 0 disables thinking mode — extraction is a structured task, not reasoning
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    )

    if (!res.ok) throw new Error(`Gemini API error: ${res.status} ${await res.text()}`)
    const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
    return data.candidates[0].content.parts[0].text
  }
}
