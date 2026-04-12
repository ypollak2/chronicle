/**
 * CLI smoke tests — integration tests for the CLI command handlers.
 *
 * Each test group:
 *   1. Creates a temp directory with a fixture .lore/ store
 *   2. `process.chdir()` to that directory so `findLoreRoot()` resolves correctly
 *   3. Calls the command function directly (not via process spawn)
 *   4. Asserts stdout/stderr output and behavior
 *
 * This layer catches bugs that core unit tests miss:
 *   - Commands crashing with valid input
 *   - Wrong output format
 *   - Missing imports in the compiled module graph
 *   - Incorrect `findLoreRoot()` behavior in test environments
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { initStore, writeStore, lorePath, addContextFact } from '@chronicle/core'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const originalCwd = process.cwd()

function makeTempDir(): string {
  const dir = join(os.tmpdir(), `chronicle-cli-smoke-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function buildLoreFixture(root: string) {
  initStore(root)
  writeStore(root, 'decisions', `# Architecture Decisions

| Date | Decision | Affects | Risk |
|------|----------|---------|------|
| 2026-04-01 | Use JWT for authentication | src/auth/ | high | <!-- confidence:0.92 -->
| 2026-04-03 | Migrate to microservices | services/, infra/ | high | <!-- confidence:0.88 -->
| 2026-04-05 | Add connection pooling | src/db/ | medium | <!-- confidence:0.95 -->
`)
  writeStore(root, 'rejected', `# Rejected Approaches

## GraphQL API layer (2026-04-04)
**Replaced by**: Plain REST
**Reason**: Team velocity dropped 40%
`)
  writeStore(root, 'risks', `# Risk Register

## High Blast Radius Files
- src/auth/jwt.ts — touched by 4 decisions
`)
}

/** Capture stdout (process.stdout.write) and console.log output during fn() */
async function captureLog(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = []
  const origWrite = process.stdout.write.bind(process.stdout)
  const origLog = console.log
  ;(process.stdout as NodeJS.WriteStream & { write: (...a: unknown[]) => boolean }).write = (
    (chunk: unknown) => { chunks.push(String(chunk)); return true }
  ) as never
  console.log = (...args: unknown[]) => chunks.push(args.map(String).join(' ') + '\n')
  try { await fn() } finally {
    process.stdout.write = origWrite
    console.log = origLog
  }
  return chunks.join('')
}

/** Capture console.error output during fn() */
async function captureError(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = []
  const orig = console.error
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(' '))
  try { await fn() } finally { console.error = orig }
  return lines.join('\n')
}

/** Run fn with process.exit mocked — returns exit code (undefined if not called) */
async function withMockedExit(fn: () => Promise<void>): Promise<number | undefined> {
  let code: number | undefined
  const orig = process.exit
  ;(process as NodeJS.Process & { exit: (c?: number) => never }).exit = ((c: number) => { code = c }) as never
  try { await fn() } catch { /* process.exit throws in real process */ }
  finally { process.exit = orig }
  return code
}

// ─── chronicle inject ─────────────────────────────────────────────────────────

describe('chronicle inject', () => {
  let root: string

  beforeEach(() => {
    root = makeTempDir()
    buildLoreFixture(root)
    process.chdir(root)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(root, { recursive: true, force: true })
  })

  it('outputs decisions.md content', async () => {
    const { cmdInject } = await import('../commands/inject.js')
    const out = await captureLog(() => cmdInject({ format: 'markdown', tokens: '8000' }))
    expect(out).toContain('JWT')
    expect(out).toContain('Architecture Decisions')
  })

  it('includes context block when context.md exists', async () => {
    addContextFact(root, 'goals', 'Build for 10k users')
    const { cmdInject } = await import('../commands/inject.js')
    const out = await captureLog(() => cmdInject({ format: 'markdown', tokens: '8000' }))
    expect(out).toContain('Project Context')
    expect(out).toContain('Build for 10k users')
  })

  it('includes decisions when --files scoped to auth/', async () => {
    const { cmdInject } = await import('../commands/inject.js')
    const out = await captureLog(() => cmdInject({ format: 'markdown', files: 'src/auth/', tokens: '8000' }))
    expect(out).toContain('JWT')
  })

  it('includes rejected approaches in output', async () => {
    const { cmdInject } = await import('../commands/inject.js')
    const out = await captureLog(() => cmdInject({ format: 'markdown', full: true, tokens: '8000' }))
    expect(out).toContain('GraphQL')
  })
})

// ─── chronicle relate ─────────────────────────────────────────────────────────

describe('chronicle relate', () => {
  let root: string

  beforeEach(() => {
    root = makeTempDir()
    buildLoreFixture(root)
    process.chdir(root)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(root, { recursive: true, force: true })
  })

  it('adds depends-on relation — relation appears in decisions.md', async () => {
    const { cmdRelate } = await import('../commands/relate.js')
    await captureLog(() => cmdRelate({ title: 'Use JWT for authentication', dependsOn: 'Add connection pooling' }))
    const content = readFileSync(lorePath(root, 'decisions.md'), 'utf8')
    expect(content).toContain('dependsOn')
    expect(content).toContain('Add connection pooling')
  })

  it('adds supersedes relation', async () => {
    const { cmdRelate } = await import('../commands/relate.js')
    await captureLog(() => cmdRelate({ title: 'Use JWT for authentication', supersedes: 'Old sessions' }))
    const content = readFileSync(lorePath(root, 'decisions.md'), 'utf8')
    expect(content).toContain('supersedes')
  })

  it('prints error and exits 1 when title not found', async () => {
    const { cmdRelate } = await import('../commands/relate.js')
    let exitCode: number | undefined
    const err = await captureError(async () => {
      exitCode = await withMockedExit(() => cmdRelate({ title: 'Totally Nonexistent Decision XYZ', dependsOn: 'Something' }))
    })
    // Either error message or exit code should indicate failure
    expect(err.toLowerCase().includes('not found') || exitCode === 1).toBe(true)
  })
})

// ─── chronicle context ────────────────────────────────────────────────────────

describe('chronicle context', () => {
  let root: string

  beforeEach(() => {
    root = makeTempDir()
    initStore(root)
    process.chdir(root)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(root, { recursive: true, force: true })
  })

  it('add --goal writes to context.md', async () => {
    const { cmdContext } = await import('../commands/context.js')
    await cmdContext({ action: 'add', goal: 'Serve 10k concurrent users' })
    const { readContext } = await import('@chronicle/core')
    expect(readContext(root).goals).toContain('Serve 10k concurrent users')
  })

  it('add --constraint writes constraint', async () => {
    const { cmdContext } = await import('../commands/context.js')
    await cmdContext({ action: 'add', constraint: 'No Redis in production' })
    const { readContext } = await import('@chronicle/core')
    expect(readContext(root).constraints).toContain('No Redis in production')
  })

  it('show prints current context', async () => {
    addContextFact(root, 'goals', 'My test goal')
    const { cmdContext } = await import('../commands/context.js')
    const out = await captureLog(() => cmdContext({ action: 'show' }))
    expect(out).toContain('My test goal')
  })

  it('remove deletes a fact', async () => {
    addContextFact(root, 'goals', 'Goal to delete')
    const { cmdContext } = await import('../commands/context.js')
    await cmdContext({ action: 'remove', goal: 'Goal to delete' })
    const { readContext } = await import('@chronicle/core')
    expect(readContext(root).goals).not.toContain('Goal to delete')
  })

  it('add --non-goal writes to nonGoals', async () => {
    const { cmdContext } = await import('../commands/context.js')
    await cmdContext({ action: 'add', nonGoal: 'Not building SSO' })
    const { readContext } = await import('@chronicle/core')
    expect(readContext(root).nonGoals).toContain('Not building SSO')
  })
})

// ─── chronicle who ────────────────────────────────────────────────────────────

describe('chronicle who', () => {
  let root: string

  beforeEach(() => {
    root = makeTempDir()
    buildLoreFixture(root)
    process.chdir(root)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(root, { recursive: true, force: true })
  })

  it('shows decisions affecting the file', async () => {
    const { cmdWho } = await import('../commands/who.js')
    const out = await captureLog(() => cmdWho('src/auth/jwt.ts', {}))
    expect(out).toContain('JWT')
  })

  it('does not crash for a file with no matching decisions', async () => {
    const { cmdWho } = await import('../commands/who.js')
    await expect(cmdWho('totally/unrelated/file.ts', {})).resolves.not.toThrow()
  })

  it('shows CODEOWNERS when present', async () => {
    writeFileSync(join(root, 'CODEOWNERS'), '* @default-owner\nsrc/auth/ @auth-team\n')
    const { cmdWho } = await import('../commands/who.js')
    const out = await captureLog(() => cmdWho('src/auth/jwt.ts', {}))
    expect(out).toContain('auth-team')
  })
})

// ─── chronicle verify ─────────────────────────────────────────────────────────

describe('chronicle verify', () => {
  let root: string

  beforeEach(() => {
    root = makeTempDir()
    buildLoreFixture(root)
    process.chdir(root)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(root, { recursive: true, force: true })
  })

  it('outputs valid JSON with --json flag', async () => {
    const { cmdVerify } = await import('../commands/verify.js')
    let jsonOut = ''
    const origLog = console.log
    console.log = (...args: unknown[]) => { jsonOut += args.map(String).join(' ') }
    await withMockedExit(() => cmdVerify({ json: true }))
    console.log = origLog

    const result = JSON.parse(jsonOut)
    expect(result).toHaveProperty('loreExists', true)
    expect(result).toHaveProperty('unprocessedCommits')
    expect(result).toHaveProperty('message')
    expect(result).toHaveProperty('fresh')
  })

  it('reports loreExists=true when .lore/ is initialized', async () => {
    const { cmdVerify } = await import('../commands/verify.js')
    let jsonOut = ''
    const origLog = console.log
    console.log = (...args: unknown[]) => { jsonOut += args.map(String).join(' ') }
    await withMockedExit(() => cmdVerify({ json: true }))
    console.log = origLog

    expect(JSON.parse(jsonOut).loreExists).toBe(true)
  })

  it('exits 1 when .lore/ is missing', async () => {
    // Use rename-based isolation (same as chronicle process test) to avoid
    // CI environments where os.tmpdir() resolves under the checkout root.
    const loreDir = join(root, '.lore')
    const loreHidden = loreDir + '-hidden'
    renameSync(loreDir, loreHidden)

    const { cmdVerify } = await import('../commands/verify.js')

    let exitCode: number | undefined
    const origLog = console.log
    console.log = () => {}
    const origErr = console.error
    console.error = () => {}
    exitCode = await withMockedExit(() => cmdVerify({ json: true }))
    console.log = origLog
    console.error = origErr

    renameSync(loreHidden, loreDir)  // restore before afterEach cleanup
    expect(exitCode).toBe(1)
  })
})

// ─── chronicle verify — freshness ────────────────────────────────────────────

describe('chronicle verify — freshness detection', () => {
  let root: string

  beforeEach(() => {
    root = makeTempDir()
    // Build a minimal git repo so git log works
    const { execSync: exec } = require('child_process')
    exec('git init', { cwd: root })
    exec('git config user.email "t@t.com"', { cwd: root })
    exec('git config user.name "T"', { cwd: root })
    writeFileSync(join(root, 'file.ts'), 'export {}')
    exec('git add . && git commit -m "init"', { cwd: root })
    initStore(root)
    // Write a minimal decisions.md so cmdVerify doesn't exit on missing file
    writeStore(root, 'decisions', '# Decision Log\n\n| Date | Decision | Affects | Risk |\n|------|----------|---------|------|\n')
    process.chdir(root)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(root, { recursive: true, force: true })
  })

  it('reports unprocessedCommits >= 1 when cache is empty', async () => {
    const { cmdVerify } = await import('../commands/verify.js')
    let jsonOut = ''
    const origLog = console.log
    console.log = (...args: unknown[]) => { jsonOut += args.map(String).join(' ') }
    await withMockedExit(() => cmdVerify({ json: true, maxLag: '100' }))
    console.log = origLog

    const result = JSON.parse(jsonOut)
    // Repo has at least 1 commit with no cache entries → must be unprocessed
    expect(result.unprocessedCommits).toBeGreaterThanOrEqual(1)
  })

  it('reports unprocessedCommits=0 when all commits are cached', async () => {
    const { execSync: exec } = require('child_process')
    // Get the actual commit hash
    const hash = exec('git log -1 --format=%H', { cwd: root }).toString().trim()
    // Write a cache file containing that hash
    const cacheData = JSON.stringify({ [hash]: { isDecision: false, isRejection: false, title: '', affects: [], risk: 'low', confidence: 0, rationale: '', isDeep: false } })
    writeFileSync(join(lorePath(root), '.extraction-cache.json'), cacheData)

    const { cmdVerify } = await import('../commands/verify.js')
    let jsonOut = ''
    const origLog = console.log
    console.log = (...args: unknown[]) => { jsonOut += args.map(String).join(' ') }
    await withMockedExit(() => cmdVerify({ json: true, maxLag: '0' }))
    console.log = origLog

    const result = JSON.parse(jsonOut)
    expect(result.unprocessedCommits).toBe(0)
    expect(result.fresh).toBe(true)
  })

  it('exits 1 and reports stale when unprocessed commits exceed maxLag', async () => {
    const { cmdVerify } = await import('../commands/verify.js')
    let jsonOut = ''
    const origLog = console.log
    console.log = (...args: unknown[]) => { jsonOut += args.map(String).join(' ') }
    const exitCode = await withMockedExit(() => cmdVerify({ json: true, maxLag: '0' }))
    console.log = origLog

    const result = JSON.parse(jsonOut)
    // maxLag=0 and cache is empty → at least 1 commit is unprocessed → stale
    expect(result.fresh).toBe(false)
    expect(exitCode).toBe(1)
  })
})

// ─── chronicle process --dry-run ──────────────────────────────────────────────

describe('chronicle process', () => {
  let root: string

  beforeEach(() => {
    root = makeTempDir()
    buildLoreFixture(root)
    process.chdir(root)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(root, { recursive: true, force: true })
  })

  it('dry-run: does not crash with no git repo', async () => {
    const { cmdProcess } = await import('../commands/process.js')
    const out = await captureLog(() => cmdProcess({ dryRun: true, depth: '1month' }))
    // No git repo → getCommits returns [] → "already up-to-date"
    expect(out.toLowerCase()).toMatch(/up-to-date|nothing|0 commits|dry-run/)
  })

  it('exits 1 when .lore/ is missing', async () => {
    // Temporarily hide .lore/ rather than cd-ing to a separate tmpdir.
    // cd-based approaches are fragile in CI when os.tmpdir() sits under the
    // checkout root (GitHub Actions), causing findLoreRoot() to find .lore/ anyway.
    const loreDir = join(root, '.lore')
    const loreHidden = loreDir + '-hidden'
    renameSync(loreDir, loreHidden)

    const { cmdProcess } = await import('../commands/process.js')

    let exitCode: number | undefined
    const origErr = console.error
    console.error = () => {}
    exitCode = await withMockedExit(() => cmdProcess({ dryRun: true }))
    console.error = origErr

    renameSync(loreHidden, loreDir)  // restore before afterEach cleanup
    expect(exitCode).toBe(1)
  })
})

// ─── chronicle doctor — new checks ───────────────────────────────────────────
// Doctor calls process.exit(1) when there are git errors (no .git dir in temp).
// We use withMockedExit so the test can capture output without throwing.

describe('chronicle doctor — orphaned ADRs', () => {
  let root: string

  beforeEach(() => {
    root = makeTempDir()
    buildLoreFixture(root)
    process.chdir(root)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(root, { recursive: true, force: true })
  })

  it('reports ok when all ADR files are linked from decisions.md', async () => {
    const adrDir = join(root, '.lore', 'decisions')
    mkdirSync(adrDir, { recursive: true })
    writeFileSync(join(adrDir, 'use-jwt.md'), '# Use JWT\n')
    writeStore(root, 'decisions', `# Decision Log\n\n| Date | Decision | Affects | Risk | ADR |\n|------|----------|---------|------|-----|\n| 2026-04-01 | Use JWT | src/auth/ | high | [→](decisions/use-jwt.md) |\n`)

    const { cmdDoctor } = await import('../commands/doctor.js')
    let out = ''
    await withMockedExit(() => captureLog(cmdDoctor).then(s => { out = s }))
    expect(out).toMatch(/1 files in decisions/)
    expect(out).not.toMatch(/orphaned/)
  })

  it('warns when an ADR file is not linked from decisions.md', async () => {
    const adrDir = join(root, '.lore', 'decisions')
    mkdirSync(adrDir, { recursive: true })
    writeFileSync(join(adrDir, 'orphaned-decision.md'), '# Orphaned\n')

    const { cmdDoctor } = await import('../commands/doctor.js')
    let out = ''
    await withMockedExit(() => captureLog(cmdDoctor).then(s => { out = s }))
    expect(out).toMatch(/orphaned/)
    expect(out).toMatch(/orphaned-decision\.md/)
  })
})

describe('chronicle doctor — evolution integrity', () => {
  let root: string

  beforeEach(() => {
    root = makeTempDir()
    buildLoreFixture(root)
    process.chdir(root)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(root, { recursive: true, force: true })
  })

  it('reports ok when eras have distinct decision counts', async () => {
    writeStore(root, 'evolution',
      '# Project — System Evolution\n\n' +
      '## Era: Genesis → v0.1.0\n\n**Decisions (3):**\n- A\n- B\n- C\n\n---\n\n' +
      '## Era: v0.1.0 → v0.2.0\n\n**Decisions (1):**\n- D\n\n---\n'
    )

    const { cmdDoctor } = await import('../commands/doctor.js')
    let out = ''
    await withMockedExit(() => captureLog(cmdDoctor).then(s => { out = s }))
    expect(out).toMatch(/Evolution integrity/)
    expect(out).toMatch(/distinct/)
  })

  it('warns when all eras show the same decision count (corruption pattern)', async () => {
    const era = (tag: string) =>
      `## Era: ${tag}\n\n**Decisions (5):** A, B, C, D, E\n\n---\n`
    writeStore(root, 'evolution',
      '# Project — System Evolution\n\n' +
      era('Genesis → v0.1.0') +
      era('v0.1.0 → v0.2.0') +
      era('v0.2.0 → v0.3.0')
    )

    const { cmdDoctor } = await import('../commands/doctor.js')
    let out = ''
    await withMockedExit(() => captureLog(cmdDoctor).then(s => { out = s }))
    expect(out).toMatch(/Evolution integrity/)
    expect(out).toMatch(/corruption|regen/)
  })
})

describe('chronicle doctor — process.log bounds', () => {
  let root: string

  beforeEach(() => {
    root = makeTempDir()
    buildLoreFixture(root)
    process.chdir(root)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(root, { recursive: true, force: true })
  })

  it('warns when process.log exceeds 500 lines', async () => {
    const logPath = join(root, '.lore', 'process.log')
    const lines = Array.from({ length: 600 }, (_, i) =>
      `2026-04-01T00:00:00.000Z | commits:1 decisions:${i} errors:0`
    )
    writeFileSync(logPath, lines.join('\n') + '\n')

    const { cmdDoctor } = await import('../commands/doctor.js')
    let out = ''
    await withMockedExit(() => captureLog(cmdDoctor).then(s => { out = s }))
    expect(out).toMatch(/process\.log/)
    expect(out).toMatch(/600|exceeds/)
  })

  it('reports ok when process.log is within bounds', async () => {
    const logPath = join(root, '.lore', 'process.log')
    writeFileSync(logPath, '2026-04-01T00:00:00.000Z | commits:1 decisions:1 errors:0\n')

    const { cmdDoctor } = await import('../commands/doctor.js')
    let out = ''
    await withMockedExit(() => captureLog(cmdDoctor).then(s => { out = s }))
    expect(out).toMatch(/process\.log.*1 lines/)
    expect(out).not.toMatch(/exceeds/)
  })
})
