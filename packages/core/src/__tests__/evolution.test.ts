import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import os from 'os'
import { initStore, writeStore } from '../store.js'
import { buildEvolution, renderEvolutionMarkdown, mergeWithExisting } from '../evolution.js'

function makeTaggedRepo(): string {
  const dir = join(os.tmpdir(), `chronicle-evo-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  execSync('git init', { cwd: dir })
  execSync('git config user.email "test@test.com"', { cwd: dir })
  execSync('git config user.name "Test"', { cwd: dir })

  // Initial commit
  writeFileSync(join(dir, 'index.ts'), 'export {}')
  execSync('git add . && git commit -m "feat: initial commit"', { cwd: dir })
  execSync('git tag v0.1.0', { cwd: dir })

  // Second commit + tag
  writeFileSync(join(dir, 'auth.ts'), 'export const auth = true')
  execSync('git add . && git commit -m "feat: add auth"', { cwd: dir })
  execSync('git tag v0.2.0', { cwd: dir })

  // Untagged work
  writeFileSync(join(dir, 'db.ts'), 'export const db = true')
  execSync('git add . && git commit -m "feat: add database"', { cwd: dir })

  initStore(dir)
  writeStore(dir, 'decisions', '# Decision Log\n\n| Decision | Affects | Risk | ADR |\n|----------|---------|------|-----|\n| Use JWT | auth.ts | high | |\n| Use Postgres | db.ts | medium | |\n')
  writeStore(dir, 'rejected', '## Prisma — rejected\nType conflicts\n\n## Redis — rejected\nOver-engineered\n')

  return dir
}

describe('buildEvolution', () => {
  let root: string
  beforeEach(() => { root = makeTaggedRepo() })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('synthesizes a single era for repo with no tags', () => {
    const dir = join(os.tmpdir(), `no-tags-${Date.now()}`)
    mkdirSync(dir)
    execSync('git init', { cwd: dir })
    execSync('git config user.email "t@t.com" && git config user.name "T"', { cwd: dir })
    writeFileSync(join(dir, 'x.ts'), 'x')
    execSync('git add . && git commit -m "init"', { cwd: dir })
    initStore(dir)
    // No tags → synthesizes a single 'v0.1 (initial)' era from commit history
    const eras = buildEvolution(dir)
    expect(eras.length).toBe(1)
    expect(eras[0].tag).toBe('v0.1 (initial)')
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates one era per tag', () => {
    const eras = buildEvolution(root)
    // v0.1.0, v0.2.0, HEAD (current) = 3 eras
    expect(eras.length).toBe(3)
  })

  it('first era has empty fromTag (genesis)', () => {
    const eras = buildEvolution(root)
    expect(eras[0].fromTag).toBe('')
    expect(eras[0].tag).toBe('v0.1.0')
  })

  it('subsequent eras chain from previous tag', () => {
    const eras = buildEvolution(root)
    expect(eras[1].fromTag).toBe('v0.1.0')
    expect(eras[1].tag).toBe('v0.2.0')
  })

  it('last era targets HEAD (current)', () => {
    const eras = buildEvolution(root)
    const last = eras[eras.length - 1]
    expect(last.tag).toContain('HEAD')
    expect(last.toDate).toBe('present')
  })

  it('includes decisions from decision log', () => {
    const eras = buildEvolution(root)
    const allDecisions = eras.flatMap(e => e.decisions)
    expect(allDecisions.some(d => d.title.includes('JWT'))).toBe(true)
  })

  it('includes rejections from rejected.md', () => {
    const eras = buildEvolution(root)
    const allRejections = eras.flatMap(e => e.rejections)
    expect(allRejections).toContain('Prisma')
    expect(allRejections).toContain('Redis')
  })
})

describe('renderEvolutionMarkdown', () => {
  it('produces markdown with era headings', () => {
    const eras = [{
      tag: 'v0.1.0', fromTag: '', fromDate: '2025-01-01', toDate: '2025-04-01',
      decisions: [{ title: 'Use JWT', risk: 'high' as const, isDeep: false }],
      rejections: ['Prisma'],
      keyFiles: ['auth.ts'],
    }]
    const md = renderEvolutionMarkdown(eras, 'MyProject')
    expect(md).toContain('# MyProject — System Evolution')
    expect(md).toContain('## Era: Genesis → v0.1.0')
    expect(md).toContain('Use JWT')
    expect(md).toContain('Prisma')
    expect(md).toContain('auth.ts')
  })

  it('marks high-risk decisions with ⚠', () => {
    const eras = [{
      tag: 'v1.0.0', fromTag: '', fromDate: '2025-01-01', toDate: '2025-04-01',
      decisions: [{ title: 'Risky change', risk: 'high' as const, isDeep: false }],
      rejections: [], keyFiles: [],
    }]
    expect(renderEvolutionMarkdown(eras)).toContain('⚠')
  })

  it('marks ADR decisions with [ADR]', () => {
    const eras = [{
      tag: 'v1.0.0', fromTag: '', fromDate: '2025-01-01', toDate: '2025-04-01',
      decisions: [{ title: 'Major arch', risk: 'high' as const, isDeep: true }],
      rejections: [], keyFiles: [],
    }]
    expect(renderEvolutionMarkdown(eras)).toContain('[ADR]')
  })
})

describe('mergeWithExisting', () => {
  it('preserves manual summaries from existing file', () => {
    const existing = `# Evolution\n\n## Era: Genesis → v0.1.0\n\n> This was our MVP phase\n\nSome content`
    const newMd = `# Evolution\n\n## Era: Genesis → v0.1.0\n\nNew content`
    const merged = mergeWithExisting(newMd, existing)
    expect(merged).toContain('This was our MVP phase')
  })

  it('returns new markdown unchanged when no manual summaries exist', () => {
    const existing = `# Evolution\n\n## Era: Genesis → v0.1.0\n\nNo summaries`
    const newMd = `# Evolution\n\n## Era: Genesis → v0.1.0\n\nNew content`
    expect(mergeWithExisting(newMd, existing)).toBe(newMd)
  })
})
