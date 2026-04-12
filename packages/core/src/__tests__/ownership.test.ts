import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import os from 'os'
import {
  loadOwnership,
  getOwnersForFile,
  parseAuthorFromRow,
  setAuthorOnRow,
  buildOwnershipSection,
  writeLoreOwnership,
} from '../ownership.js'
import { initStore } from '../store.js'

function makeTempDir(): string {
  const dir = join(os.tmpdir(), `chronicle-ownership-test-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

// ─── loadOwnership ────────────────────────────────────────────────────────────

describe('loadOwnership', () => {
  let root: string

  beforeEach(() => { root = makeTempDir() })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('returns source=none when no CODEOWNERS or ownership.md', () => {
    const result = loadOwnership(root)
    expect(result.source).toBe('none')
    expect(result.patterns).toHaveLength(0)
  })

  it('loads CODEOWNERS from repo root', () => {
    writeFileSync(join(root, 'CODEOWNERS'), '# comment\n*.ts @alice\nsrc/ @bob @carol\n')
    const result = loadOwnership(root)
    expect(result.source).toBe('codeowners')
    expect(result.patterns).toHaveLength(2)
    expect(result.patterns[0].pattern).toBe('*.ts')
    expect(result.patterns[0].owners).toEqual(['@alice'])
    expect(result.patterns[1].pattern).toBe('src/')
    expect(result.patterns[1].owners).toEqual(['@bob', '@carol'])
  })

  it('loads CODEOWNERS from .github/CODEOWNERS', () => {
    mkdirSync(join(root, '.github'))
    writeFileSync(join(root, '.github', 'CODEOWNERS'), 'src/ @team\n')
    const result = loadOwnership(root)
    expect(result.source).toBe('codeowners')
    expect(result.patterns[0].owners).toEqual(['@team'])
  })

  it('falls back to .lore/ownership.md when no CODEOWNERS', () => {
    initStore(root)
    writeLoreOwnership(root, [{ pattern: 'src/', owners: ['@alice'] }])
    const result = loadOwnership(root)
    expect(result.source).toBe('lore')
    expect(result.patterns[0].pattern).toBe('src/')
    expect(result.patterns[0].owners).toEqual(['@alice'])
  })

  it('ignores blank lines and comments in CODEOWNERS', () => {
    writeFileSync(join(root, 'CODEOWNERS'), '\n# This is a comment\n\n*.ts @alice\n')
    const result = loadOwnership(root)
    expect(result.patterns).toHaveLength(1)
  })

  it('ignores lines without owners in CODEOWNERS', () => {
    writeFileSync(join(root, 'CODEOWNERS'), 'src/\n*.ts @alice\n')
    const result = loadOwnership(root)
    expect(result.patterns).toHaveLength(1)  // src/ has no owners, *.ts has one
  })
})

// ─── getOwnersForFile ─────────────────────────────────────────────────────────

describe('getOwnersForFile', () => {
  it('returns empty array when no patterns', () => {
    const map = { patterns: [], source: 'none' as const }
    expect(getOwnersForFile('src/auth.ts', map)).toEqual([])
  })

  it('matches *.ts pattern', () => {
    const map = { patterns: [{ pattern: '*.ts', owners: ['@alice'] }], source: 'codeowners' as const }
    expect(getOwnersForFile('index.ts', map)).toEqual(['@alice'])
  })

  it('matches directory prefix', () => {
    const map = { patterns: [{ pattern: 'src/', owners: ['@bob'] }], source: 'codeowners' as const }
    expect(getOwnersForFile('src/auth/jwt.ts', map)).toEqual(['@bob'])
  })

  it('uses last-matching-rule wins semantics', () => {
    const map = {
      patterns: [
        { pattern: '*.ts', owners: ['@generic'] },
        { pattern: 'src/auth/*.ts', owners: ['@auth-team'] },
      ],
      source: 'codeowners' as const,
    }
    // src/auth/jwt.ts should match the more specific second rule
    expect(getOwnersForFile('src/auth/jwt.ts', map)).toEqual(['@auth-team'])
  })

  it('handles leading slash in file path', () => {
    const map = { patterns: [{ pattern: 'src/', owners: ['@alice'] }], source: 'codeowners' as const }
    expect(getOwnersForFile('/src/index.ts', map)).toEqual(['@alice'])
  })

  it('returns empty array when no pattern matches', () => {
    const map = { patterns: [{ pattern: 'docs/', owners: ['@docs'] }], source: 'codeowners' as const }
    expect(getOwnersForFile('src/index.ts', map)).toEqual([])
  })

  it('matches ** glob pattern', () => {
    const map = { patterns: [{ pattern: 'src/**/tests/', owners: ['@test-team'] }], source: 'codeowners' as const }
    expect(getOwnersForFile('src/auth/tests/jwt.test.ts', map)).toEqual(['@test-team'])
  })
})

// ─── parseAuthorFromRow ───────────────────────────────────────────────────────

describe('parseAuthorFromRow', () => {
  it('returns null when no author comment', () => {
    expect(parseAuthorFromRow('| 2024-01-01 | Use JWT | src/ | high |')).toBeNull()
  })

  it('parses author from comment', () => {
    const row = '| 2024-01-01 | Use JWT | src/ | high | <!-- author:alice@example.com -->'
    expect(parseAuthorFromRow(row)).toBe('alice@example.com')
  })

  it('trims whitespace from author', () => {
    const row = '| 2024-01-01 | Use JWT | src/ | high | <!-- author:  alice  -->'
    expect(parseAuthorFromRow(row)).toBe('alice')
  })
})

// ─── setAuthorOnRow ───────────────────────────────────────────────────────────

describe('setAuthorOnRow', () => {
  it('appends author comment when none exists', () => {
    const row = '| 2024-01-01 | Use JWT | src/ | high |'
    const result = setAuthorOnRow(row, 'alice@example.com')
    expect(result).toContain('<!-- author:alice@example.com -->')
    expect(parseAuthorFromRow(result)).toBe('alice@example.com')
  })

  it('replaces existing author comment', () => {
    const row = '| 2024-01-01 | Use JWT | src/ | high | <!-- author:old@example.com -->'
    const result = setAuthorOnRow(row, 'new@example.com')
    expect(result).toContain('new@example.com')
    expect(result).not.toContain('old@example.com')
    expect((result.match(/<!-- author:/g) ?? []).length).toBe(1)
  })
})

// ─── buildOwnershipSection ────────────────────────────────────────────────────

describe('buildOwnershipSection', () => {
  let root: string

  beforeEach(() => { root = makeTempDir() })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('returns empty string when no ownership configured', () => {
    const result = buildOwnershipSection(root, ['src/index.ts'])
    expect(result).toBe('')
  })

  it('returns empty string when files array is empty', () => {
    writeFileSync(join(root, 'CODEOWNERS'), 'src/ @alice\n')
    expect(buildOwnershipSection(root, [])).toBe('')
  })

  it('returns empty string when no files match any pattern', () => {
    writeFileSync(join(root, 'CODEOWNERS'), 'docs/ @alice\n')
    const result = buildOwnershipSection(root, ['src/index.ts'])
    expect(result).toBe('')
  })

  it('includes file ownership when patterns match', () => {
    writeFileSync(join(root, 'CODEOWNERS'), 'src/ @alice\n')
    const result = buildOwnershipSection(root, ['src/index.ts'])
    expect(result).toContain('## File Ownership')
    expect(result).toContain('@alice')
  })
})

// ─── writeLoreOwnership ───────────────────────────────────────────────────────

describe('writeLoreOwnership', () => {
  let root: string

  beforeEach(() => { root = makeTempDir(); initStore(root) })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('writes ownership.md and can be read back by loadOwnership', () => {
    const patterns = [
      { pattern: 'src/', owners: ['@alice'] },
      { pattern: 'docs/', owners: ['@bob', '@carol'] },
    ]
    writeLoreOwnership(root, patterns)
    const map = loadOwnership(root)
    expect(map.source).toBe('lore')
    expect(map.patterns).toHaveLength(2)
    expect(map.patterns[0].owners).toEqual(['@alice'])
    expect(map.patterns[1].owners).toEqual(['@bob', '@carol'])
  })
})
