import type { LLMProvider } from '@chronicle/core'

// Thin adapter — each provider speaks to the same LLMProvider interface
// New providers (Gemini, OpenAI) are added here without touching extractor logic
export function makeLLMProvider(name: string): LLMProvider {
  switch (name) {
    case 'anthropic': return makeAnthropicProvider()
    case 'openai':    return makeOpenAIProvider()
    case 'gemini':    return makeGeminiProvider()
    default: throw new Error(`Unknown LLM provider: ${name}. Options: anthropic|openai|gemini`)
  }
}

function makeAnthropicProvider(): LLMProvider {
  return async (prompt) => {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

    const res = await fetch('https://api.anthropic.com/v1/messages', {
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

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
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

function makeGeminiProvider(): LLMProvider {
  return async (prompt) => {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('GEMINI_API_KEY not set')

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    )

    if (!res.ok) throw new Error(`Gemini API error: ${res.status} ${await res.text()}`)
    const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
    return data.candidates[0].content.parts[0].text
  }
}
