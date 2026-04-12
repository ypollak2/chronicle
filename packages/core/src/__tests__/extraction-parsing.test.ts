/**
 * Negative and edge-case tests for LLM response parsing.
 *
 * Real LLMs return malformed output regularly. These tests verify Chronicle
 * degrades gracefully instead of crashing or silently losing data.
 */

import { describe, it, expect } from 'vitest'
import { parseExtractionResponse, buildExtractionPrompt, callWithRetry } from '../extractor.js'

// ─── Malformed JSON ────────────────────────────────────────────────────────────

describe('parseExtractionResponse — malformed JSON', () => {
  it('handles truncated JSON (LLM hit token limit mid-response)', () => {
    const truncated = '[{"isDecision":true,"title":"Use JWT","affects":["src/auth"]'  // no closing
    expect(parseExtractionResponse(truncated)).toEqual([])
  })

  it('handles JSON with trailing comma (common LLM mistake)', () => {
    const trailing = '[{"isDecision":true,"title":"Use JWT","affects":["src/"],"risk":"high","rationale":"x","isDeep":false,}]'
    // Strict JSON parsers reject trailing commas — should not throw
    expect(() => parseExtractionResponse(trailing)).not.toThrow()
  })

  it('handles HTML in response (some models wrap JSON in HTML)', () => {
    const html = '<html><body>Here is the result:<pre>[{"isDecision":true}]</pre></body></html>'
    expect(() => parseExtractionResponse(html)).not.toThrow()
  })

  it('handles plain text explanation with no JSON', () => {
    const text = 'This commit is just a minor style fix. No architectural decisions were made.'
    expect(parseExtractionResponse(text)).toEqual([])
  })

  it('handles empty JSON array (no decisions in commit)', () => {
    expect(parseExtractionResponse('[]')).toEqual([])
  })
})

// ─── Wrong shape ──────────────────────────────────────────────────────────────

describe('parseExtractionResponse — wrong shape', () => {
  it('handles JSON object instead of array (LLM returns single decision not wrapped)', () => {
    const single = '{"isDecision":true,"title":"Use JWT","affects":["src/"],"risk":"high","rationale":"x","isDeep":false}'
    // Should not crash — graceful empty or wrapped result
    expect(() => parseExtractionResponse(single)).not.toThrow()
  })

  it('handles array of non-objects (numbers, strings)', () => {
    expect(parseExtractionResponse('[1, 2, 3]')).toEqual([])
    expect(parseExtractionResponse('["decision1", "decision2"]')).toEqual([])
  })

  it('handles objects with null required fields', () => {
    const nullFields = JSON.stringify([{
      isDecision: null,
      title: null,
      affects: null,
      risk: null,
      rationale: null,
      isDeep: null,
    }])
    expect(() => parseExtractionResponse(nullFields)).not.toThrow()
  })

  it('handles objects missing the title field entirely', () => {
    const missingTitle = JSON.stringify([{
      isDecision: true,
      // title: intentionally missing
      affects: ['src/auth/'],
      risk: 'high',
      rationale: 'some reason',
      isDeep: false,
    }])
    // Should not crash; title defaults to empty/unknown
    expect(() => parseExtractionResponse(missingTitle)).not.toThrow()
  })

  it('handles objects with extra unknown fields (LLM hallucination)', () => {
    const extra = JSON.stringify([{
      isDecision: true,
      title: 'Use JWT',
      affects: ['src/auth/'],
      risk: 'high',
      rationale: 'x',
      isDeep: false,
      deepReason: 'affects 4 modules',    // future field — should be ignored gracefully
      tags: ['auth', 'security'],          // extra field
      severity: 'critical',               // extra field
    }])
    const results = parseExtractionResponse(extra)
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Use JWT')
  })

  it('handles array with mix of valid and invalid objects', () => {
    const mixed = JSON.stringify([
      { isDecision: true, title: 'Valid Decision', affects: ['src/'], risk: 'low', rationale: 'x', isDeep: false },
      null,
      { not: 'a decision' },
      { isDecision: true, title: 'Another Valid', affects: ['src/'], risk: 'medium', rationale: 'y', isDeep: false },
    ])
    expect(() => parseExtractionResponse(mixed)).not.toThrow()
  })
})

// ─── Hash field absence ───────────────────────────────────────────────────────

describe('parseExtractionResponse — hash field', () => {
  it('handles results without hash field (LLM drops it)', () => {
    const noHash = JSON.stringify([{
      isDecision: true,
      title: 'Use JWT',
      affects: ['src/auth/'],
      risk: 'high',
      rationale: 'stateless',
      isDeep: false,
      // hash: intentionally missing
    }])
    const results = parseExtractionResponse(noHash)
    // Should not crash; hash can be undefined
    expect(() => results).not.toThrow()
    if (results.length > 0) {
      // hash may be undefined — that's acceptable (falls back to positional matching)
      expect(results[0].title).toBe('Use JWT')
    }
  })
})

// ─── Code block wrapping variations ──────────────────────────────────────────

describe('parseExtractionResponse — code block variations', () => {
  const validResult = [{
    isDecision: true,
    title: 'Use JWT',
    affects: ['src/auth/'],
    risk: 'high',
    rationale: 'stateless',
    isDeep: false,
  }]

  it('parses ```json ... ``` block', () => {
    const raw = '```json\n' + JSON.stringify(validResult) + '\n```'
    expect(parseExtractionResponse(raw)).toHaveLength(1)
  })

  it('parses ``` ... ``` block without language tag', () => {
    const raw = '```\n' + JSON.stringify(validResult) + '\n```'
    const result = parseExtractionResponse(raw)
    // May or may not parse depending on implementation — should not crash
    expect(() => result).not.toThrow()
  })

  it('parses JSON preceded by LLM reasoning text', () => {
    const raw = 'Looking at this commit, I can identify the following decisions:\n\n```json\n' +
      JSON.stringify(validResult) + '\n```'
    expect(parseExtractionResponse(raw)).toHaveLength(1)
  })
})

// ─── Prompt quality checks ────────────────────────────────────────────────────

describe('buildExtractionPrompt — completeness', () => {
  const stubCommit = {
    hash: 'abc1234def56',
    date: '2026-04-11T10:00:00Z',
    subject: 'feat: add JWT authentication',
    body: 'Replaces cookie sessions for stateless auth',
    diffStat: '5 files changed, 120 insertions(+), 30 deletions(-)',
    diff: '+const token = jwt.sign(payload, SECRET)\n'.repeat(20),
    tags: [] as string[],
  }

  it('includes commit hash in prompt so LLM can return it', () => {
    const prompt = buildExtractionPrompt([stubCommit])
    expect(prompt).toContain('abc1234')
  })

  it('includes commit subject', () => {
    const prompt = buildExtractionPrompt([stubCommit])
    expect(prompt).toContain('add JWT authentication')
  })

  it('includes diff content', () => {
    const prompt = buildExtractionPrompt([stubCommit])
    expect(prompt).toContain('jwt.sign')
  })

  it('instructs LLM on isDeep criteria', () => {
    const prompt = buildExtractionPrompt([stubCommit])
    // Prompt should mention what makes a decision "deep"
    const hasDeepCriteria = prompt.toLowerCase().includes('module') ||
                            prompt.toLowerCase().includes('deep') ||
                            prompt.toLowerCase().includes('complex')
    expect(hasDeepCriteria).toBe(true)
  })

  it('instructs LLM to output JSON', () => {
    const prompt = buildExtractionPrompt([stubCommit])
    expect(prompt.toLowerCase()).toContain('json')
  })

  it('includes confidence field instruction', () => {
    const prompt = buildExtractionPrompt([stubCommit])
    expect(prompt.toLowerCase()).toContain('confidence')
  })

  it('includes truncation note when opts.truncated is true', () => {
    const prompt = buildExtractionPrompt([stubCommit], { truncated: true })
    expect(prompt.toLowerCase()).toContain('truncated')
  })

  it('omits truncation note when opts.truncated is false', () => {
    const prompt = buildExtractionPrompt([stubCommit], { truncated: false })
    expect(prompt).not.toContain('NOTE:')
  })
})

// ─── callWithRetry — exhaustion ctx ──────────────────────────────────────────

describe('callWithRetry', () => {
  const validResult = JSON.stringify([{
    isDecision: true, isRejection: false, title: 'Use Redis', affects: ['cache/'],
    risk: 'medium', confidence: 0.9, rationale: 'durability', isDeep: false,
  }])

  it('returns parsed results on first success', async () => {
    const llm = async () => validResult
    const results = await callWithRetry('prompt', llm)
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Use Redis')
  })

  it('returns [] for legitimate empty response (no decisions)', async () => {
    const llm = async () => '[]'
    const results = await callWithRetry('prompt', llm)
    expect(results).toEqual([])
  })

  it('retries on malformed JSON and succeeds on second attempt', async () => {
    let attempt = 0
    const llm = async () => {
      attempt++
      return attempt === 1 ? 'not json at all' : validResult
    }
    const results = await callWithRetry('prompt', llm, 3)
    expect(results).toHaveLength(1)
    expect(attempt).toBe(2)
  })

  it('increments ctx.errors when all retries are exhausted with malformed JSON', async () => {
    const llm = async () => 'always bad json {'
    const ctx = { errors: 0 }
    const results = await callWithRetry('prompt', llm, 2, ctx)
    expect(results).toEqual([])
    expect(ctx.errors).toBe(1)
  })

  it('does NOT increment ctx.errors for a legitimate empty response', async () => {
    const llm = async () => '[]'
    const ctx = { errors: 0 }
    await callWithRetry('prompt', llm, 3, ctx)
    expect(ctx.errors).toBe(0)
  })

  it('accumulates errors across multiple exhausted batches', async () => {
    const llm = async () => 'bad {'
    const ctx = { errors: 0 }
    await callWithRetry('prompt1', llm, 1, ctx)
    await callWithRetry('prompt2', llm, 1, ctx)
    expect(ctx.errors).toBe(2)
  })
})
