import { describe, it, expect, vi } from 'vitest'
import {
  parseExtractionResponse, buildExtractionPrompt, extractFromCommits,
  type CommitMeta, type ExtractionResult, type ExtractionCache
} from '../extractor.js'

const stubCommit = (overrides: Partial<CommitMeta> = {}): CommitMeta => ({
  hash: 'abc1234',
  date: '2025-04-10T10:00:00Z',
  subject: 'feat: add JWT authentication',
  body: 'Replaces session-based auth',
  diffStat: '3 files changed, 80 insertions(+), 20 deletions(-)',
  diff: '+const token = jwt.sign(payload, secret)\n'.repeat(25),
  tags: [],
  ...overrides,
})

const stubResult = (overrides: Partial<ExtractionResult> = {}): ExtractionResult => ({
  isDecision: true,
  isRejection: false,
  title: 'Switch to JWT auth',
  affects: ['auth/'],
  risk: 'high',
  rationale: 'Sessions require Redis; JWT is stateless',
  isDeep: false,
  ...overrides,
})

describe('parseExtractionResponse', () => {
  it('parses a valid JSON array', () => {
    const raw = JSON.stringify([stubResult()])
    expect(parseExtractionResponse(raw)).toHaveLength(1)
  })

  it('parses JSON wrapped in markdown code block', () => {
    const raw = '```json\n' + JSON.stringify([stubResult()]) + '\n```'
    expect(parseExtractionResponse(raw)).toHaveLength(1)
  })

  it('returns empty array for invalid JSON', () => {
    expect(parseExtractionResponse('not json')).toEqual([])
  })

  it('returns empty array when JSON is not an array', () => {
    expect(parseExtractionResponse('{"key":"value"}')).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseExtractionResponse('')).toEqual([])
  })
})

describe('buildExtractionPrompt', () => {
  it('includes commit subject and diff in prompt', () => {
    const prompt = buildExtractionPrompt([stubCommit()])
    expect(prompt).toContain('feat: add JWT authentication')
    expect(prompt).toContain('jwt.sign')
  })

  it('includes tags when present', () => {
    const prompt = buildExtractionPrompt([stubCommit({ tags: ['v1.0.0'] })])
    expect(prompt).toContain('v1.0.0')
  })

  it('handles multiple commits', () => {
    const commits = [
      stubCommit({ hash: 'aaa', subject: 'feat: feature A' }),
      stubCommit({ hash: 'bbb', subject: 'feat: feature B' }),
    ]
    const prompt = buildExtractionPrompt(commits)
    expect(prompt).toContain('feature A')
    expect(prompt).toContain('feature B')
  })
})

describe('extractFromCommits', () => {
  const mockLLM = vi.fn().mockResolvedValue(JSON.stringify([stubResult()]))

  it('calls LLM and returns parsed results', async () => {
    const results = await extractFromCommits([stubCommit()], mockLLM)
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Switch to JWT auth')
  })

  it('skips cached commits', async () => {
    const cache: ExtractionCache = {
      has: vi.fn().mockReturnValue(true),
      get: vi.fn(),
      set: vi.fn(),
    }
    mockLLM.mockClear()
    await extractFromCommits([stubCommit()], mockLLM, { cache })
    expect(mockLLM).not.toHaveBeenCalled()
  })

  it('batches commits respecting BATCH_SIZE=6', async () => {
    // Use a small diff (~50 chars) so the count limit (6) triggers before the char limit (5000)
    const smallDiff = '+const x = 1\n'.repeat(3)
    const commits = Array.from({ length: 13 }, (_, i) =>
      stubCommit({ hash: `hash${i}`, subject: `feat: feature ${i}`, diff: smallDiff })
    )
    mockLLM.mockClear()
    mockLLM.mockResolvedValue(JSON.stringify([stubResult()]))
    await extractFromCommits(commits, mockLLM)
    // 13 commits ÷ 6 per batch → 3 batches (6 + 6 + 1)
    expect(mockLLM).toHaveBeenCalledTimes(3)
  })

  it('throws for unimplemented strategies', async () => {
    await expect(
      extractFromCommits([stubCommit()], mockLLM, { strategy: 'clustered' })
    ).rejects.toThrow('v2 roadmap')
  })

  it('stores results in cache after processing', async () => {
    const stored: Record<string, ExtractionResult> = {}
    const cache: ExtractionCache = {
      has: (hash) => hash in stored,
      get: (hash) => stored[hash],
      set: (hash, result) => { stored[hash] = result },
    }
    mockLLM.mockResolvedValueOnce(JSON.stringify([stubResult()]))
    await extractFromCommits([stubCommit()], mockLLM, { cache })
    expect(stored['abc1234']).toBeDefined()
  })
})
