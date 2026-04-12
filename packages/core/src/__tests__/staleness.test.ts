import { describe, it, expect } from 'vitest'
import { annotateStaleDecisions, formatStaleWarning, type FileModMap, type StaleDecision } from '../staleness.js'

// Helper: build a FileModMap from a plain object
function modMap(entries: Record<string, number>): FileModMap {
  return new Map(Object.entries(entries))
}

// Helper: date offset from now
function daysAgo(n: number): number {
  return Date.now() - n * 86_400_000
}

const HEADER = '| Date | Decision | Affects | Risk |\n|------|----------|---------|------|\n'

// ─── annotateStaleDecisions ───────────────────────────────────────────────────

describe('annotateStaleDecisions', () => {
  it('returns unchanged content when modMap is empty', () => {
    const content = HEADER + '| 2020-01-01 | Use JWT | src/auth/ | high |'
    const { annotated, stale } = annotateStaleDecisions(content, modMap({}))
    expect(annotated).toBe(content)
    expect(stale).toHaveLength(0)
  })

  it('does not flag decisions newer than 60 days', () => {
    const recent = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
    const content = HEADER + `| ${recent} | New feature | src/app/ | low |`
    const map = modMap({ 'src/app/index.ts': Date.now() })
    const { stale } = annotateStaleDecisions(content, map)
    expect(stale).toHaveLength(0)
  })

  it('flags a stale decision when affected file was modified after decision date', () => {
    const content = HEADER + '| 2020-01-01 | Use JWT | src/auth/ | high |'
    const map = modMap({ 'src/auth/jwt.ts': daysAgo(10) })
    const { annotated, stale } = annotateStaleDecisions(content, map)
    expect(annotated).toContain('<!-- stale -->')
    expect(stale).toHaveLength(1)
    expect(stale[0].title).toBe('Use JWT')
    expect(stale[0].date).toBe('2020-01-01')
    expect(stale[0].affects).toContain('src/auth/')
  })

  it('does not flag when affected file was modified BEFORE decision date', () => {
    const content = HEADER + '| 2025-01-01 | Use JWT | src/auth/ | high |'
    // File modified 2 years before decision
    const map = modMap({ 'src/auth/jwt.ts': new Date('2023-01-01').getTime() })
    const { stale } = annotateStaleDecisions(content, map)
    expect(stale).toHaveLength(0)
  })

  it('skips rows without a date column', () => {
    const content = HEADER + '| no-date | Some thing | src/ | low |'
    const map = modMap({ 'src/index.ts': daysAgo(1) })
    const { stale } = annotateStaleDecisions(content, map)
    expect(stale).toHaveLength(0)
  })

  it('skips rows already marked stale', () => {
    const content = HEADER + '| 2020-01-01 | Use JWT | src/auth/ | high | <!-- stale -->'
    const map = modMap({ 'src/auth/jwt.ts': daysAgo(10) })
    const { annotated } = annotateStaleDecisions(content, map)
    // Should not double-append
    expect(annotated.match(/<!-- stale -->/g)).toHaveLength(1)
  })

  it('skips separator rows', () => {
    const content = '|------|----------|---------|------|'
    const { annotated } = annotateStaleDecisions(content, modMap({}))
    expect(annotated).toBe(content)
  })

  it('skips rows with no affects column', () => {
    const content = HEADER + '| 2020-01-01 | Some thing |  | low |'
    const map = modMap({ 'src/index.ts': daysAgo(1) })
    const { stale } = annotateStaleDecisions(content, map)
    expect(stale).toHaveLength(0)
  })

  it('matches file paths that include the pattern', () => {
    const content = HEADER + '| 2020-01-01 | Refactor | auth | high |'
    const map = modMap({ 'src/auth/middleware.ts': daysAgo(5) })
    const { stale } = annotateStaleDecisions(content, map)
    expect(stale).toHaveLength(1)
  })

  it('handles multiple affects columns', () => {
    const content = HEADER + '| 2020-01-01 | Big refactor | src/api/, src/db/ | high |'
    const map = modMap({ 'src/db/connection.ts': daysAgo(5) })
    const { stale } = annotateStaleDecisions(content, map)
    expect(stale).toHaveLength(1)
    expect(stale[0].affects).toContain('src/db/')
  })

  it('returns multiple stale decisions', () => {
    const content = [
      HEADER,
      '| 2020-01-01 | Decision A | src/a/ | low |',
      '| 2020-01-02 | Decision B | src/b/ | low |',
      '| 2020-01-03 | Decision C | src/c/ | low |',
    ].join('\n')
    const map = modMap({
      'src/a/index.ts': daysAgo(5),
      'src/c/index.ts': daysAgo(3),
    })
    const { stale } = annotateStaleDecisions(content, map)
    expect(stale).toHaveLength(2)
    expect(stale.map(s => s.title)).toContain('Decision A')
    expect(stale.map(s => s.title)).toContain('Decision C')
  })

  it('preserves non-table lines unchanged', () => {
    const content = '# Decision Log\n\nSome intro text.\n\n' + HEADER + '| 2020-01-01 | Use JWT | src/ | high |'
    const { annotated } = annotateStaleDecisions(content, modMap({}))
    expect(annotated).toContain('# Decision Log')
    expect(annotated).toContain('Some intro text.')
  })
})

// ─── formatStaleWarning ───────────────────────────────────────────────────────

describe('formatStaleWarning', () => {
  it('returns empty string when no stale decisions', () => {
    expect(formatStaleWarning([])).toBe('')
  })

  it('includes warning heading and decision details', () => {
    const stale: StaleDecision[] = [
      { title: 'Use JWT for authentication', date: '2020-01-01', affects: ['src/auth/'] },
    ]
    const result = formatStaleWarning(stale)
    expect(result).toContain('Potentially Stale')
    expect(result).toContain('2020-01-01')
    expect(result).toContain('Use JWT')
    expect(result).toContain('src/auth/')
  })

  it('truncates long titles to 60 chars', () => {
    const longTitle = 'A'.repeat(80)
    const stale: StaleDecision[] = [{ title: longTitle, date: '2020-01-01', affects: ['src/'] }]
    const result = formatStaleWarning(stale)
    expect(result).not.toContain('A'.repeat(70))
    expect(result).toContain('A'.repeat(60))
  })

  it('shows ellipsis when affects has more than 2 items', () => {
    const stale: StaleDecision[] = [
      { title: 'Big change', date: '2020-01-01', affects: ['src/a/', 'src/b/', 'src/c/'] },
    ]
    const result = formatStaleWarning(stale)
    expect(result).toContain('…')
  })

  it('does not add ellipsis for 2 or fewer affects', () => {
    const stale: StaleDecision[] = [
      { title: 'Small change', date: '2020-01-01', affects: ['src/a/', 'src/b/'] },
    ]
    const result = formatStaleWarning(stale)
    expect(result).not.toContain('…')
  })

  it('handles multiple stale decisions', () => {
    const stale: StaleDecision[] = [
      { title: 'Use JWT', date: '2020-01-01', affects: ['src/auth/'] },
      { title: 'Add Redis', date: '2021-06-01', affects: ['src/cache/'] },
    ]
    const result = formatStaleWarning(stale)
    expect(result).toContain('Use JWT')
    expect(result).toContain('Add Redis')
  })
})
