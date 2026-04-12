import { describe, it, expect } from 'vitest'
import {
  parseRelations,
  serializeRelations,
  addRelationToRow,
  removeRelationFromRow,
  extractTitleFromRow,
  buildRelationGraph,
  getRelatedRows,
  buildMermaidDAG,
  applyRelationToContent,
} from '../relations.js'

// ─── parseRelations ───────────────────────────────────────────────────────────

describe('parseRelations', () => {
  it('returns empty object when no comment present', () => {
    expect(parseRelations('| 2024-01-01 | Use JWT | src/ | high |')).toEqual({})
  })

  it('parses dependsOn', () => {
    const row = '| 2024-01-01 | Use JWT | src/ | high | <!-- relations:{"dependsOn":["Add Redis"]} -->'
    expect(parseRelations(row)).toEqual({ dependsOn: ['Add Redis'] })
  })

  it('parses supersedes', () => {
    const row = '| 2024-01-01 | Use JWT | src/ | high | <!-- relations:{"supersedes":["Old Auth"]} -->'
    expect(parseRelations(row)).toEqual({ supersedes: ['Old Auth'] })
  })

  it('parses relatedTo', () => {
    const row = '| 2024-01-01 | Use JWT | src/ | high | <!-- relations:{"relatedTo":["Auth Refactor"]} -->'
    expect(parseRelations(row)).toEqual({ relatedTo: ['Auth Refactor'] })
  })

  it('parses multiple relation types', () => {
    const row = '| 2024-01-01 | Use JWT | src/ | high | <!-- relations:{"dependsOn":["A"],"supersedes":["B"],"relatedTo":["C"]} -->'
    const result = parseRelations(row)
    expect(result.dependsOn).toEqual(['A'])
    expect(result.supersedes).toEqual(['B'])
    expect(result.relatedTo).toEqual(['C'])
  })

  it('returns empty object on invalid JSON', () => {
    const row = '| 2024-01-01 | Use JWT | src/ | high | <!-- relations:{invalid} -->'
    expect(parseRelations(row)).toEqual({})
  })
})

// ─── serializeRelations ───────────────────────────────────────────────────────

describe('serializeRelations', () => {
  it('returns empty string for empty relations', () => {
    expect(serializeRelations({})).toBe('')
  })

  it('returns empty string for relations with empty arrays', () => {
    expect(serializeRelations({ dependsOn: [], supersedes: [], relatedTo: [] })).toBe('')
  })

  it('serializes dependsOn', () => {
    const result = serializeRelations({ dependsOn: ['Add Redis'] })
    expect(result).toBe('<!-- relations:{"dependsOn":["Add Redis"]} -->')
  })

  it('omits empty arrays from output', () => {
    const result = serializeRelations({ dependsOn: ['A'], supersedes: [] })
    expect(result).toContain('dependsOn')
    expect(result).not.toContain('supersedes')
  })

  it('round-trips through parseRelations', () => {
    const rels = { dependsOn: ['A'], supersedes: ['B'], relatedTo: ['C'] }
    const serialized = serializeRelations(rels)
    expect(parseRelations(`some row ${serialized}`)).toEqual(rels)
  })
})

// ─── addRelationToRow ─────────────────────────────────────────────────────────

describe('addRelationToRow', () => {
  const row = '| 2024-01-01 | Use JWT | src/auth/ | high |'

  it('adds a new relation comment to a row with no relations', () => {
    const result = addRelationToRow(row, 'dependsOn', 'Add Redis')
    expect(result).toContain('<!-- relations:')
    expect(result).toContain('Add Redis')
  })

  it('is idempotent — does not duplicate targets', () => {
    const r1 = addRelationToRow(row, 'dependsOn', 'Add Redis')
    const r2 = addRelationToRow(r1, 'dependsOn', 'Add Redis')
    expect(r2.match(/Add Redis/g)).toHaveLength(1)
  })

  it('adds a second relation to an existing comment', () => {
    const r1 = addRelationToRow(row, 'dependsOn', 'Add Redis')
    const r2 = addRelationToRow(r1, 'supersedes', 'Old Auth')
    const rels = parseRelations(r2)
    expect(rels.dependsOn).toContain('Add Redis')
    expect(rels.supersedes).toContain('Old Auth')
  })

  it('replaces the existing relations comment (not duplicates it)', () => {
    const r1 = addRelationToRow(row, 'dependsOn', 'A')
    const r2 = addRelationToRow(r1, 'dependsOn', 'B')
    expect((r2.match(/<!-- relations:/g) ?? []).length).toBe(1)
  })
})

// ─── removeRelationFromRow ────────────────────────────────────────────────────

describe('removeRelationFromRow', () => {
  it('returns unchanged row when no relations comment exists', () => {
    const row = '| 2024-01-01 | Use JWT | src/ | high |'
    expect(removeRelationFromRow(row, 'dependsOn', 'X')).toBe(row)
  })

  it('removes a specific target from a relation array', () => {
    const row = '| 2024-01-01 | Use JWT | src/ | high | <!-- relations:{"dependsOn":["A","B"]} -->'
    const result = removeRelationFromRow(row, 'dependsOn', 'A')
    const rels = parseRelations(result)
    expect(rels.dependsOn).toEqual(['B'])
  })

  it('removes the entire comment when last relation is removed', () => {
    const row = '| 2024-01-01 | Use JWT | src/ | high | <!-- relations:{"dependsOn":["A"]} -->'
    const result = removeRelationFromRow(row, 'dependsOn', 'A')
    expect(result).not.toContain('<!-- relations:')
  })

  it('does nothing when target is not present', () => {
    const row = '| 2024-01-01 | Use JWT | src/ | high | <!-- relations:{"dependsOn":["A"]} -->'
    const result = removeRelationFromRow(row, 'dependsOn', 'nonexistent')
    expect(parseRelations(result).dependsOn).toEqual(['A'])
  })
})

// ─── extractTitleFromRow ──────────────────────────────────────────────────────

describe('extractTitleFromRow', () => {
  it('extracts title from a standard row', () => {
    expect(extractTitleFromRow('| 2024-01-01 | Use JWT for auth | src/ | high |')).toBe('Use JWT for auth')
  })

  it('returns null for non-data rows (headers, separators)', () => {
    expect(extractTitleFromRow('| Date | Decision | Affects | Risk |')).toBeNull()
    expect(extractTitleFromRow('|------|----------|---------|------|')).toBeNull()
  })

  it('returns null for non-table lines', () => {
    expect(extractTitleFromRow('# Header')).toBeNull()
    expect(extractTitleFromRow('')).toBeNull()
  })

  it('strips inline comments from the title', () => {
    const row = '| 2024-01-01 | Use JWT <!-- confidence:0.9 --> | src/ | high |'
    expect(extractTitleFromRow(row)).toBe('Use JWT')
  })

  it('trims whitespace', () => {
    expect(extractTitleFromRow('| 2024-01-01 |   Use JWT   | src/ | high |')).toBe('Use JWT')
  })
})

// ─── buildRelationGraph ───────────────────────────────────────────────────────

describe('buildRelationGraph', () => {
  it('returns empty map for content with no relations', () => {
    const content = '| 2024-01-01 | Use JWT | src/ | high |'
    expect(buildRelationGraph(content).size).toBe(0)
  })

  it('builds graph from rows with relations', () => {
    const content = [
      '| 2024-01-01 | Use JWT | src/ | high | <!-- relations:{"dependsOn":["Add Redis"]} -->',
      '| 2024-01-02 | Add Redis | src/cache/ | medium |',
    ].join('\n')
    const graph = buildRelationGraph(content)
    expect(graph.size).toBe(1)
    expect(graph.get('Use JWT')?.dependsOn).toContain('Add Redis')
  })

  it('skips non-table lines', () => {
    const content = '# Header\n\n| 2024-01-01 | Use JWT | src/ | high | <!-- relations:{"relatedTo":["X"]} -->'
    const graph = buildRelationGraph(content)
    expect(graph.size).toBe(1)
  })
})

// ─── getRelatedRows ───────────────────────────────────────────────────────────

describe('getRelatedRows', () => {
  const content = [
    '| 2024-01-01 | Use JWT | src/ | high | <!-- relations:{"dependsOn":["Add Redis"]} -->',
    '| 2024-01-02 | Add Redis | src/cache/ | medium | <!-- relations:{"relatedTo":["Use JWT"]} -->',
    '| 2024-01-03 | Migrate DB | db/ | high |',
  ].join('\n')

  it('finds rows that reference the target title', () => {
    const rows = getRelatedRows(content, 'Add Redis')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('Use JWT')
  })

  it('is case-insensitive', () => {
    const rows = getRelatedRows(content, 'add redis')
    expect(rows).toHaveLength(1)
  })

  it('returns empty array when no matches', () => {
    expect(getRelatedRows(content, 'nonexistent decision')).toEqual([])
  })

  it('matches partial title', () => {
    const rows = getRelatedRows(content, 'Redis')
    expect(rows.length).toBeGreaterThan(0)
  })
})

// ─── buildMermaidDAG ──────────────────────────────────────────────────────────

describe('buildMermaidDAG', () => {
  it('returns empty string for empty graph', () => {
    expect(buildMermaidDAG(new Map())).toBe('')
  })

  it('returns empty string when graph has nodes but no edges', () => {
    // A graph with only entries that have no relation arrays
    const graph = new Map([['Use JWT', {}]])
    expect(buildMermaidDAG(graph)).toBe('')
  })

  it('generates a flowchart TD header', () => {
    const graph = new Map([['Use JWT', { dependsOn: ['Add Redis'] }]])
    const result = buildMermaidDAG(graph)
    expect(result).toContain('flowchart TD')
  })

  it('emits node labels for all referenced titles', () => {
    const graph = new Map([['Use JWT', { dependsOn: ['Add Redis'] }]])
    const result = buildMermaidDAG(graph)
    expect(result).toContain('Use JWT')
    expect(result).toContain('Add Redis')
  })

  it('emits correct edge labels for dependsOn', () => {
    const graph = new Map([['Use JWT', { dependsOn: ['Add Redis'] }]])
    expect(buildMermaidDAG(graph)).toContain('depends on')
  })

  it('emits correct edge labels for supersedes', () => {
    const graph = new Map([['New Auth', { supersedes: ['Old Auth'] }]])
    expect(buildMermaidDAG(graph)).toContain('supersedes')
  })

  it('emits correct edge labels for relatedTo', () => {
    const graph = new Map([['API Rate Limiting', { relatedTo: ['Auth Middleware'] }]])
    expect(buildMermaidDAG(graph)).toContain('related to')
  })

  it('handles multiple edges', () => {
    const graph = new Map([
      ['A', { dependsOn: ['B'], supersedes: ['C'] }],
    ])
    const result = buildMermaidDAG(graph)
    expect(result).toContain('depends on')
    expect(result).toContain('supersedes')
  })

  it('truncates long titles to 50 chars in node labels', () => {
    const longTitle = 'A'.repeat(60)
    const graph = new Map([[longTitle, { dependsOn: ['Short'] }]])
    const result = buildMermaidDAG(graph)
    expect(result).not.toContain('A'.repeat(51))
  })
})

// ─── applyRelationToContent ───────────────────────────────────────────────────

describe('applyRelationToContent', () => {
  const content = [
    '# Decision Log',
    '',
    '| Date | Decision | Affects | Risk |',
    '|------|----------|---------|------|',
    '| 2024-01-01 | Use JWT | src/auth/ | high |',
    '| 2024-01-02 | Add Redis | src/cache/ | medium |',
  ].join('\n')

  it('returns found=true and updated content when title matches', () => {
    const { updated, found } = applyRelationToContent(content, 'Use JWT', 'dependsOn', 'Add Redis')
    expect(found).toBe(true)
    expect(updated).toContain('<!-- relations:')
    expect(updated).toContain('Add Redis')
  })

  it('returns found=false when title does not match', () => {
    const { found } = applyRelationToContent(content, 'nonexistent', 'dependsOn', 'Add Redis')
    expect(found).toBe(false)
  })

  it('is case-insensitive match', () => {
    const { found } = applyRelationToContent(content, 'use jwt', 'dependsOn', 'Add Redis')
    expect(found).toBe(true)
  })

  it('preserves non-matching rows', () => {
    const { updated } = applyRelationToContent(content, 'Use JWT', 'dependsOn', 'X')
    expect(updated).toContain('Add Redis | src/cache/')
    expect(updated).toContain('# Decision Log')
  })

  it('handles partial title match', () => {
    const { found } = applyRelationToContent(content, 'JWT', 'relatedTo', 'Add Redis')
    expect(found).toBe(true)
  })
})
