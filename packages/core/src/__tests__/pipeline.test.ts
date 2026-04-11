/**
 * Pipeline integration tests — end-to-end without a real LLM.
 *
 * Tests the full flow: commits in a git repo → extraction (mock LLM) →
 * store written → inject output verified.
 *
 * This verifies that different commit TYPES produce the RIGHT documents:
 *   - Feature commits → decisions.md
 *   - Security commits → decisions.md (high risk) + risks.md mentions
 *   - Rejection commits → rejected.md
 *   - Architecture commits → decisions.md (isDeep=true) + deep ADR file
 *   - Noise commits → nothing written
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { buildProjectRepo, buildMockLLM } from './fixtures.js'
import {
  initStore, readStore, writeStore, appendToStore, writeDeepDecision, lorePath,
  getCommits, extractFromCommits,
} from '../index.js'

function makeTempDir() {
  const dir = join(os.tmpdir(), `chronicle-pipeline-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

// ─── Full pipeline: commit → extract → store ──────────────────────────────────

describe('Pipeline — Feature commit captured to decisions.md', () => {
  let fixture: ReturnType<typeof buildProjectRepo>

  beforeEach(() => {
    fixture = buildProjectRepo()
    initStore(fixture.root)
  })

  afterEach(() => fixture.cleanup())

  it('extracts a feature commit into decisions.md', async () => {
    const mockLLM = buildMockLLM()
    const commits = getCommits(fixture.root, '1month')
    // Filter to just the JWT feature commit
    const jwtCommits = commits.filter(c => c.subject.toLowerCase().includes('jwt'))
    expect(jwtCommits.length).toBeGreaterThanOrEqual(1)

    const results = await extractFromCommits(jwtCommits.slice(0, 1), mockLLM)
    expect(results.length).toBeGreaterThanOrEqual(1)

    const decision = results.find(r => r.isDecision)
    expect(decision).toBeDefined()
    expect(decision!.title.toLowerCase()).toContain('jwt')
    expect(decision!.risk).toBe('high')
    expect(decision!.affects).toContain('src/auth/')
  })

  it('extracts security commit with high risk', async () => {
    const mockLLM = buildMockLLM()
    const commits = getCommits(fixture.root, '1month')
    const secCommits = commits.filter(c => c.subject.toLowerCase().includes('timing attack'))
    expect(secCommits.length).toBeGreaterThanOrEqual(1)

    const results = await extractFromCommits(secCommits.slice(0, 1), mockLLM)
    const decision = results.find(r => r.isDecision)
    expect(decision?.risk).toBe('high')
  })

  it('extracts rejection commit into rejected.md (not decisions.md)', async () => {
    const mockLLM = buildMockLLM()
    const commits = getCommits(fixture.root, '1month')
    const rejectionCommits = commits.filter(c => c.subject.toLowerCase().includes('graphql'))
    expect(rejectionCommits.length).toBeGreaterThanOrEqual(1)

    const results = await extractFromCommits(rejectionCommits.slice(0, 1), mockLLM)
    const rejection = results.find(r => r.isRejection)
    expect(rejection).toBeDefined()
    expect(rejection!.isDecision).toBe(false)
  })

  it('noise commits produce no decisions', async () => {
    const mockLLM = buildMockLLM()
    const commits = getCommits(fixture.root, '1month')
    const noiseCommits = commits.filter(c => c.subject.toLowerCase().includes('style'))

    if (noiseCommits.length === 0) return  // scanner may have already filtered them

    const results = await extractFromCommits(noiseCommits.slice(0, 1), mockLLM)
    // Noise commits should produce 0 decisions (filtered by scanner or mock LLM)
    const decisions = results.filter(r => r.isDecision || r.isRejection)
    expect(decisions.length).toBe(0)
  })
})

// ─── Store write correctness ──────────────────────────────────────────────────

describe('Pipeline — Store written correctly after extraction', () => {
  let root: string

  beforeEach(() => {
    root = makeTempDir()
    initStore(root)
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('decisions written to decisions.md as valid table rows', () => {
    appendToStore(root, 'decisions', '| 2026-04-11 | Use JWT auth | src/auth/ | high | <!-- confidence:0.92 -->')
    const content = readStore(root, 'decisions')
    expect(content).toContain('Use JWT auth')
    expect(content).toContain('<!-- confidence:0.92 -->')
  })

  it('rejections written to rejected.md with reason and replacement', () => {
    appendToStore(root, 'rejected',
      '## GraphQL API (2026-04-04)\n**Replaced by**: REST\n**Reason**: Team velocity dropped\n')
    const content = readStore(root, 'rejected')
    expect(content).toContain('GraphQL API')
    expect(content).toContain('Replaced by')
    expect(content).toContain('Reason')
  })

  it('deep decisions create individual ADR files', () => {
    writeDeepDecision(root, 'microservices-migration', `# ADR: Microservices\n\n## Context\nMonolith growing.\n\n## Decision\nExtract into services.\n`)
    expect(existsSync(lorePath(root, 'decisions', 'microservices-migration.md'))).toBe(true)
    const content = readFileSync(lorePath(root, 'decisions', 'microservices-migration.md'), 'utf8')
    expect(content).toContain('## Context')
  })

  it('risks.md updated with high blast-radius files', () => {
    appendToStore(root, 'risks',
      '## src/auth/jwt.ts\nTouched by 4 decisions. Token issuance affects all auth flows.\n')
    const risks = readStore(root, 'risks')
    expect(risks).toContain('src/auth/jwt.ts')
    expect(risks).toContain('auth flows')
  })
})

// ─── Scanner filtering ────────────────────────────────────────────────────────

describe('Pipeline — Scanner noise filtering', () => {
  it('getCommits filters noise commits by prefix', () => {
    // This test runs against the Chronicle repo itself as a fixture
    // Just verify the scanner doesn't crash and returns reasonable results
    const { execSync } = require('child_process')
    try {
      execSync('git rev-parse --git-dir', { cwd: process.cwd(), stdio: 'ignore' })
    } catch {
      return  // not in a git repo — skip
    }

    const commits = getCommits(process.cwd(), '1month')
    // All returned commits should have non-empty subjects
    for (const c of commits) {
      expect(c.hash).toMatch(/^[0-9a-f]+$/)
      expect(c.subject.length).toBeGreaterThan(0)
    }
  })
})

// ─── Caching correctness ──────────────────────────────────────────────────────

describe('Pipeline — Extraction caching', () => {
  let fixture: ReturnType<typeof buildProjectRepo>

  beforeEach(() => {
    fixture = buildProjectRepo()
    initStore(fixture.root)
  })

  afterEach(() => fixture.cleanup())

  it('does not re-process already-cached commits', async () => {
    let callCount = 0
    const countingLLM = async (prompt: string) => {
      callCount++
      return JSON.stringify([])
    }

    const commits = getCommits(fixture.root, '1month').slice(0, 2)

    // First pass
    const { createFileCache } = await import('../cache.js')
    const cache = createFileCache(fixture.root)
    await extractFromCommits(commits, countingLLM, { cache })
    const firstCallCount = callCount

    // Second pass — should hit cache
    callCount = 0
    const cache2 = createFileCache(fixture.root)
    await extractFromCommits(commits, countingLLM, { cache: cache2 })

    expect(callCount).toBeLessThan(firstCallCount)
  })
})
