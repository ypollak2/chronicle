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
    // keyFiles are suppressed when decisions exist (decisions tell a richer story)
    expect(md).not.toContain('auth.ts')
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

describe('renderEvolutionMarkdown — risk ordering + keyFiles suppression', () => {
  it('renders high-risk decisions before low-risk ones', () => {
    const eras = [{
      tag: 'v1.0.0', fromTag: '', fromDate: '2025-01-01', toDate: '2025-06-01',
      decisions: [
        { title: 'Low risk change', risk: 'low' as const, isDeep: false },
        { title: 'High risk change', risk: 'high' as const, isDeep: false },
        { title: 'Medium risk change', risk: 'medium' as const, isDeep: false },
      ],
      rejections: [],
      keyFiles: ['src/index.ts'],
    }]
    const md = renderEvolutionMarkdown(eras)
    const highIdx = md.indexOf('High risk change')
    const medIdx = md.indexOf('Medium risk change')
    const lowIdx = md.indexOf('Low risk change')
    expect(highIdx).toBeLessThan(medIdx)
    expect(medIdx).toBeLessThan(lowIdx)
  })

  it('hides keyFiles section when decisions exist', () => {
    const eras = [{
      tag: 'v1.0.0', fromTag: '', fromDate: '2025-01-01', toDate: '2025-06-01',
      decisions: [{ title: 'Some decision', risk: 'low' as const, isDeep: false }],
      rejections: [],
      keyFiles: ['src/important.ts'],
    }]
    const md = renderEvolutionMarkdown(eras)
    expect(md).not.toContain('Most changed files')
    expect(md).not.toContain('src/important.ts')
  })

  it('shows keyFiles section when no decisions exist', () => {
    const eras = [{
      tag: 'v1.0.0', fromTag: '', fromDate: '2025-01-01', toDate: '2025-06-01',
      decisions: [],
      rejections: [],
      keyFiles: ['src/important.ts'],
    }]
    const md = renderEvolutionMarkdown(eras)
    expect(md).toContain('Most changed files')
    expect(md).toContain('src/important.ts')
  })
})

describe('buildEvolution — date-range filtering', () => {
  it('filters decisions by date range when dates are present in decisions.md', () => {
    const dir = join(os.tmpdir(), `chronicle-date-filter-${Date.now()}`)
    mkdirSync(dir)
    execSync('git init', { cwd: dir })
    execSync('git config user.email "t@t.com" && git config user.name "T"', { cwd: dir })
    writeFileSync(join(dir, 'x.ts'), 'x')
    execSync('git add . && git commit -m "init"', { cwd: dir })
    execSync('git tag v0.1.0', { cwd: dir })
    writeFileSync(join(dir, 'y.ts'), 'y')
    execSync('git add . && git commit -m "add y"', { cwd: dir })
    execSync('git tag v0.2.0', { cwd: dir })
    initStore(dir)
    // Write decisions with dates — second decision is well after any tag date
    writeStore(dir, 'decisions',
      '# Decision Log\n\n| Date | Decision | Affects | Risk | ADR |\n|------|----------|---------|------|-----|\n' +
      '| 2020-01-01 | Very old decision | src/ | low | |\n' +
      '| 2099-01-01 | Far future decision | src/ | high | |\n'
    )
    const eras = buildEvolution(dir)
    const allDecisions = eras.flatMap(e => e.decisions)
    // Not all decisions should be in all eras — at least one era should exclude some
    expect(eras.length).toBeGreaterThan(0)
    // Very old decision should not be in the future era (HEAD era)
    const headEra = eras.find(e => e.tag.includes('HEAD'))
    if (headEra) {
      expect(headEra.decisions.some(d => d.title.includes('Very old'))).toBe(false)
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('does not repeat same-date decisions across multiple same-day eras', () => {
    // Regression test for: all 16 eras showing identical decisions when all tags
    // were created on the same calendar day.
    const dir = join(os.tmpdir(), `chronicle-same-day-${Date.now()}`)
    mkdirSync(dir)
    execSync('git init', { cwd: dir })
    execSync('git config user.email "t@t.com" && git config user.name "T"', { cwd: dir })
    writeFileSync(join(dir, 'a.ts'), 'a')
    execSync('git add . && git commit -m "init"', { cwd: dir })
    execSync('git tag v0.1.0', { cwd: dir })
    execSync('git tag v0.2.0', { cwd: dir })
    execSync('git tag v0.3.0', { cwd: dir })

    // All three tags on same day — write decisions with today's date
    const today = new Date().toISOString().slice(0, 10)
    initStore(dir)
    writeStore(dir, 'decisions',
      '# Decision Log\n\n| Date | Decision | Affects | Risk | ADR |\n|------|----------|---------|------|-----|\n' +
      `| ${today} | Decision A | src/ | low | |\n` +
      `| ${today} | Decision B | lib/ | high | |\n`
    )

    const eras = buildEvolution(dir)
    expect(eras.length).toBeGreaterThanOrEqual(3)

    // Each decision should appear in exactly one era total (no duplicates)
    const allTitles = eras.flatMap(e => e.decisions.map(d => d.title))
    expect(allTitles.filter(t => t === 'Decision A')).toHaveLength(1)
    expect(allTitles.filter(t => t === 'Decision B')).toHaveLength(1)

    // The genesis era (first) should contain the decisions; later same-day eras should not
    expect(eras[0].decisions.map(d => d.title)).toContain('Decision A')
    expect(eras[1].decisions.map(d => d.title)).not.toContain('Decision A')
    expect(eras[2].decisions.map(d => d.title)).not.toContain('Decision A')

    rmSync(dir, { recursive: true, force: true })
  })
})
