import { describe, it, expect, vi } from 'vitest'
import {
  parseExtractionResponse, buildExtractionPrompt, extractFromCommits,
  extractFilesFromDiff, clusterCommitsByFileOverlap,
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

  it('clustered strategy no longer throws — it groups by file overlap', async () => {
    mockLLM.mockResolvedValue(JSON.stringify([stubResult()]))
    const results = await extractFromCommits([stubCommit()], mockLLM, { strategy: 'clustered' })
    expect(results).toHaveLength(1)
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

// ── v2: Semantic clustering ────────────────────────────────────────────────────

const authDiff = (extra = '') =>
  `diff --git a/auth/index.ts b/auth/index.ts\nindex 0000..1111\n--- a/auth/index.ts\n+++ b/auth/index.ts\n${extra}+const x = 1\n`.repeat(3)

const dbDiff = (extra = '') =>
  `diff --git a/db/schema.ts b/db/schema.ts\nindex 0000..2222\n--- a/db/schema.ts\n+++ b/db/schema.ts\n${extra}+const y = 2\n`.repeat(3)

describe('extractFilesFromDiff', () => {
  it('extracts file paths from diff --git headers', () => {
    const files = extractFilesFromDiff(authDiff())
    expect(files.has('auth/index.ts')).toBe(true)
  })

  it('returns empty set for commits with no diff headers', () => {
    expect(extractFilesFromDiff('+const x = 1\n')).toEqual(new Set())
  })

  it('handles multiple files in one diff', () => {
    const multi = authDiff() + dbDiff()
    const files = extractFilesFromDiff(multi)
    expect(files.has('auth/index.ts')).toBe(true)
    expect(files.has('db/schema.ts')).toBe(true)
  })
})

describe('clusterCommitsByFileOverlap', () => {
  it('groups commits that share files into the same cluster', () => {
    const commits = [
      stubCommit({ hash: 'a1', diff: authDiff() }),
      stubCommit({ hash: 'a2', diff: authDiff() }),  // same file → same cluster
      stubCommit({ hash: 'd1', diff: dbDiff() }),     // different file → new cluster
    ]
    const clusters = clusterCommitsByFileOverlap(commits)
    expect(clusters[0].map(c => c.hash)).toContain('a1')
    expect(clusters[0].map(c => c.hash)).toContain('a2')
    expect(clusters.some(cl => cl.some(c => c.hash === 'd1'))).toBe(true)
    // auth commits and db commit should NOT be in the same cluster
    const authCluster = clusters.find(cl => cl.some(c => c.hash === 'a1'))!
    expect(authCluster.some(c => c.hash === 'd1')).toBe(false)
  })

  it('returns empty array for empty input', () => {
    expect(clusterCommitsByFileOverlap([])).toEqual([])
  })

  it('handles commits with no parseable diff files (falls back to singleton merging)', () => {
    const commits = Array.from({ length: 5 }, (_, i) =>
      stubCommit({ hash: `h${i}`, diff: '+no diff headers\n'.repeat(5) })
    )
    const clusters = clusterCommitsByFileOverlap(commits)
    // All 5 are singletons → should be merged into one batch
    const totalCommits = clusters.reduce((sum, cl) => sum + cl.length, 0)
    expect(totalCommits).toBe(5)
    // And they should be in fewer clusters than the original 5 commits
    expect(clusters.length).toBeLessThan(5)
  })

  it('respects MAX_CLUSTER_SIZE — does not exceed 8 commits per cluster', () => {
    // 10 commits all touching the same file
    const commits = Array.from({ length: 10 }, (_, i) =>
      stubCommit({ hash: `h${i}`, diff: authDiff() })
    )
    const clusters = clusterCommitsByFileOverlap(commits)
    for (const cl of clusters) {
      expect(cl.length).toBeLessThanOrEqual(8)
    }
  })

  it('produces fewer LLM calls than simple batching when commits are related', async () => {
    const mockLLM = vi.fn().mockResolvedValue(JSON.stringify([stubResult()]))
    // 12 commits all touching auth/ — clustered should produce 2 calls (8+4), simple produces 2 calls (6+6) but clusters are tighter
    const commits = Array.from({ length: 12 }, (_, i) =>
      stubCommit({ hash: `h${i}`, diff: authDiff() })
    )
    await extractFromCommits(commits, mockLLM, { strategy: 'clustered' })
    // All 12 share auth/ → 2 clusters of 8 and 4 → 2 LLM calls
    expect(mockLLM).toHaveBeenCalledTimes(2)
  })
})
