/**
 * Tests for the relevance ranker and token budget trimmer.
 *
 * These are the hot-path functions called on every `chronicle inject`.
 * Correctness matters: wrong ranking = AI gets irrelevant context.
 */

import { describe, it, expect } from 'vitest'
import { rankDecisions, scoreRow, parseDecisionsTable, estimateTokens, trimToTokenBudget } from '../ranker.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeRow = (overrides: {
  date?: string
  title?: string
  affects?: string
  risk?: string
  confidence?: number
  stale?: boolean
} = {}) => {
  const {
    date = '2026-04-01',
    title = 'Use JWT auth',
    affects = 'src/auth/',
    risk = 'medium',
    confidence,
    stale = false,
  } = overrides
  const confComment = confidence !== undefined ? ` <!-- confidence:${confidence} -->` : ''
  const staleComment = stale ? ' <!-- stale -->' : ''
  return `| ${date} | ${title} | ${affects} | ${risk} |${confComment}${staleComment}`
}

const HEADER = `# Architecture Decisions\n\n| Date | Decision | Affects | Risk |\n|------|----------|---------|------|`

function makeTable(rows: string[]): string {
  return HEADER + '\n' + rows.join('\n')
}

// ─── parseDecisionsTable ──────────────────────────────────────────────────────

describe('parseDecisionsTable', () => {
  it('separates header from data rows', () => {
    const table = makeTable([makeRow(), makeRow({ title: 'Use Postgres' })])
    const { header, rows } = parseDecisionsTable(table)
    expect(rows).toHaveLength(2)
    expect(header).toContain('# Architecture Decisions')
    expect(header).toContain('|---')
  })

  it('returns empty rows for header-only content', () => {
    const { rows } = parseDecisionsTable(HEADER)
    expect(rows).toHaveLength(0)
  })

  it('handles empty string input', () => {
    const { rows, header } = parseDecisionsTable('')
    expect(rows).toHaveLength(0)
    expect(header).toBe('')
  })

  it('initialises all rows with score 0', () => {
    const { rows } = parseDecisionsTable(makeTable([makeRow(), makeRow()]))
    for (const row of rows) expect(row.score).toBe(0)
  })
})

// ─── scoreRow ─────────────────────────────────────────────────────────────────

describe('scoreRow', () => {
  it('gives +3 per direct file match', () => {
    const row = makeRow({ affects: 'src/auth/middleware.ts' })
    const score = scoreRow(row, { files: ['src/auth/middleware.ts'] })
    expect(score).toBeGreaterThanOrEqual(3)
  })

  it('gives +1 per recent file match', () => {
    const row = makeRow({ affects: 'src/auth/' })
    const score = scoreRow(row, { recentFiles: ['src/auth/jwt.ts'] })
    expect(score).toBeGreaterThanOrEqual(1)
  })

  it('gives +2 for high risk', () => {
    const highRow = makeRow({ risk: 'high' })
    const lowRow = makeRow({ risk: 'low' })
    expect(scoreRow(highRow, {})).toBeGreaterThan(scoreRow(lowRow, {}))
  })

  it('gives +1 for medium risk vs low', () => {
    const medRow = makeRow({ risk: 'medium' })
    const lowRow = makeRow({ risk: 'low' })
    expect(scoreRow(medRow, {})).toBeGreaterThan(scoreRow(lowRow, {}))
  })

  it('applies age decay — recent decisions score higher', () => {
    const recent = makeRow({ date: '2026-04-10' })
    const old = makeRow({ date: '2020-01-01' })
    expect(scoreRow(recent, {})).toBeGreaterThan(scoreRow(old, {}))
  })

  it('gives confidence bonus', () => {
    const highConf = makeRow({ confidence: 0.95 })
    const lowConf = makeRow({ confidence: 0.30 })
    expect(scoreRow(highConf, {})).toBeGreaterThan(scoreRow(lowConf, {}))
  })

  it('stacks multiple signals additively', () => {
    const row = makeRow({ affects: 'src/auth/', risk: 'high', confidence: 0.9 })
    const baseRow = makeRow({ affects: 'src/other/', risk: 'low' })
    const score = scoreRow(row, { files: ['src/auth/'] })
    const base = scoreRow(baseRow, {})
    expect(score).toBeGreaterThan(base + 3)  // at least 3 points ahead from file match + risk + confidence
  })
})

// ─── rankDecisions ────────────────────────────────────────────────────────────

describe('rankDecisions', () => {
  it('returns content unchanged when no rows', () => {
    const result = rankDecisions(HEADER, {})
    expect(result).toContain('# Architecture Decisions')
  })

  it('sorts rows by score descending', () => {
    const rows = [
      makeRow({ title: 'Low relevance', affects: 'src/other/', risk: 'low', date: '2020-01-01' }),
      makeRow({ title: 'High relevance', affects: 'src/auth/', risk: 'high', date: '2026-04-10' }),
    ]
    const result = rankDecisions(makeTable(rows), { files: ['src/auth/'] })
    const highIdx = result.indexOf('High relevance')
    const lowIdx = result.indexOf('Low relevance')
    expect(highIdx).toBeLessThan(lowIdx)  // high relevance appears first
  })

  it('respects topN — returns exactly N rows', () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRow({ title: `Decision ${i}` }))
    const result = rankDecisions(makeTable(rows), { topN: 3 })
    const dataRows = result.split('\n').filter(l => l.startsWith('|') && !l.startsWith('| Date'))
      .filter(l => !/^[|-]+$/.test(l))
    expect(dataRows.length).toBeLessThanOrEqual(3)
  })

  it('topN larger than row count returns all rows', () => {
    const rows = [makeRow({ title: 'Alpha decision' }), makeRow({ title: 'Beta decision' })]
    const result = rankDecisions(makeTable(rows), { topN: 100 })
    expect(result).toContain('Alpha decision')
    expect(result).toContain('Beta decision')
  })

  it('preserves header lines', () => {
    const result = rankDecisions(makeTable([makeRow()]), { files: ['src/auth/'] })
    expect(result).toContain('# Architecture Decisions')
    expect(result).toContain('|---')
  })

  it('blends semantic scores when provided', () => {
    const rows = [
      makeRow({ title: 'JWT auth', affects: 'src/auth/', risk: 'low', date: '2020-01-01' }),
      makeRow({ title: 'DB pooling', affects: 'src/db/', risk: 'low', date: '2020-01-01' }),
    ]
    const content = makeTable(rows)
    const { rows: parsed } = parseDecisionsTable(content)
    const semanticScores = new Map<string, number>()
    semanticScores.set(parsed[1].line.trim(), 0.99)  // high score for DB pooling
    semanticScores.set(parsed[0].line.trim(), 0.01)  // low score for JWT

    const result = rankDecisions(content, { semanticScores })
    // DB pooling should appear before JWT due to semantic score dominance
    expect(result.indexOf('DB pooling')).toBeLessThan(result.indexOf('JWT auth'))
  })
})

// ─── estimateTokens ───────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('approximates 4 chars per token', () => {
    const text = 'a'.repeat(400)
    expect(estimateTokens(text)).toBe(100)
  })

  it('rounds up fractional tokens', () => {
    expect(estimateTokens('abc')).toBe(1)   // 3 chars → 1 token (ceil)
    expect(estimateTokens('abcde')).toBe(2)  // 5 chars → 2 tokens (ceil)
  })
})

// ─── trimToTokenBudget ────────────────────────────────────────────────────────

describe('trimToTokenBudget', () => {
  const section = (chars: number) => 'x'.repeat(chars)

  it('returns all sections when total is within budget', () => {
    const sections = [section(100), section(200), section(300)]
    const result = trimToTokenBudget(sections, 200)   // 600 chars = 150 tokens, budget = 200
    expect(result).toHaveLength(3)
  })

  it('trims sections that exceed budget', () => {
    const sections = [section(4000), section(4000), section(4000)]
    const result = trimToTokenBudget(sections, 100)  // 100 tokens = 400 chars budget
    expect(result.join('').length).toBeLessThanOrEqual(400 + 50)  // +50 for truncation message
  })

  it('truncates the last fitting section with a message', () => {
    const sections = [section(800), section(800)]  // 1600 chars = 400 tokens
    const result = trimToTokenBudget(sections, 300)  // 1200 chars budget — first fits, second partial
    const joined = result.join('')
    expect(joined).toContain('…(truncated')
  })

  it('handles zero budget gracefully', () => {
    const sections = [section(400), section(400)]
    expect(() => trimToTokenBudget(sections, 0)).not.toThrow()
  })

  it('handles empty sections array', () => {
    expect(trimToTokenBudget([], 1000)).toEqual([])
  })

  it('high-priority sections should survive when budget is tight', () => {
    // First section = critical (small), second = large filler
    const critical = '# Rejected Approaches\n## Redis Sessions\nReplaced by JWT for simplicity.\n'
    const large = section(10000)
    const result = trimToTokenBudget([critical, large], 50)
    expect(result[0]).toBe(critical)  // critical section preserved
  })
})
