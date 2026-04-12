/**
 * Integration tests: init → process → inject → verify pipeline
 *
 * These tests run the full Chronicle pipeline against a real (ephemeral) git repo,
 * with the LLM provider mocked to return deterministic decisions. This validates
 * that the commands wire together correctly end-to-end without hitting any API.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { execSync } from 'child_process'

// ── Mock LLM ─────────────────────────────────────────────────────────────────
// Must be at top-level so Vitest can hoist it before module resolution.
// All commands that dynamically import `../llm.js` (process, deepen) will get
// this mock. The factory MUST be self-contained — no references to module-scope
// variables (Vitest hoists vi.mock before all other code including const declarations).

vi.mock('../llm.js', () => ({
  detectProvider: () => 'mock',
  makeLLMProvider: () => async (_prompt: string) =>
    JSON.stringify([
      {
        isDecision: true,
        isRejection: false,
        title: 'Use TypeScript for type safety',
        affects: ['src/'],
        risk: 'medium',
        confidence: 0.9,
        rationale: 'TypeScript prevents runtime type errors and improves IDE support',
        isDeep: false,
      },
    ]),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(
    os.tmpdir(),
    `chronicle-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Create a minimal git repo with one substantial commit (≥20 diff lines). */
function makeGitRepo(dir: string): string {
  const git = (cmd: string) =>
    execSync(cmd, { cwd: dir, stdio: 'pipe', env: { ...process.env, HOME: dir } })
      .toString()
      .trim()

  git('git init')
  git('git config user.email "test@chronicle.dev"')
  git('git config user.name "Chronicle Test"')

  // 26 lines of diff — exceeds MIN_DIFF_LINES = 20
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(
    join(dir, 'src', 'index.ts'),
    [
      '// Application entry point',
      'import express from "express"',
      'import { createPool } from "pg"',
      '',
      'const app = express()',
      'const PORT = process.env.PORT ?? 3000',
      '',
      '// Database pool — chosen over single connection for concurrency',
      'const pool = createPool({',
      '  host: process.env.DB_HOST,',
      '  database: process.env.DB_NAME,',
      '  max: 10,',
      '  idleTimeoutMillis: 30000,',
      '})',
      '',
      'app.use(express.json())',
      '',
      'app.get("/health", (_req, res) => {',
      '  res.json({ status: "ok" })',
      '})',
      '',
      'app.listen(PORT, () => {',
      '  console.log(`Server on port ${PORT}`)',
      '})',
      '',
      'export { app, pool }',
    ].join('\n')
  )

  git('git add .')
  git('git commit -m "feat: initial architecture with Express and pg pool"')

  return git('git rev-parse HEAD')
}

/**
 * Capture all stdout from fn() — intercepts both process.stdout.write and
 * console.log (Vitest may intercept console before it reaches stdout.write).
 */
async function captureStdout(fn: () => Promise<void>): Promise<string> {
  let out = ''
  const origWrite = process.stdout.write.bind(process.stdout)
  const origLog = console.log.bind(console)
  ;(process.stdout as NodeJS.WriteStream & { write: (...a: unknown[]) => boolean }).write = ((
    chunk: unknown
  ) => {
    out += String(chunk)
    return true
  }) as never
  console.log = (...args: unknown[]) => {
    out += args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n'
  }
  try {
    await fn()
  } finally {
    process.stdout.write = origWrite
    console.log = origLog
  }
  return out
}

/** Run fn() with process.exit mocked; return the exit code. */
async function withMockedExit(fn: () => Promise<void>): Promise<number | undefined> {
  let captured: number | undefined
  const orig = process.exit.bind(process)
  ;(process.exit as (code?: number) => never) = ((code?: number) => {
    captured = code
  }) as never
  try {
    await fn()
  } catch {
    /* ignore */
  } finally {
    process.exit = orig
  }
  return captured
}

// ── Shared state ──────────────────────────────────────────────────────────────

let root: string
const originalCwd = process.cwd()

beforeEach(() => {
  root = makeTempDir()
  makeGitRepo(root)
  process.chdir(root)
})

afterEach(() => {
  process.chdir(originalCwd)
  rmSync(root, { recursive: true, force: true })
})

// ── chronicle init ─────────────────────────────────────────────────────────────

describe('chronicle init', () => {
  it('creates .lore/ and decisions.md', async () => {
    const { cmdInit } = await import('../commands/init.js')
    await cmdInit({ depth: 'all', llm: 'mock' })

    expect(existsSync(join(root, '.lore'))).toBe(true)
    expect(existsSync(join(root, '.lore', 'decisions.md'))).toBe(true)
  })

  it('writes the mocked decision title to decisions.md', async () => {
    const { cmdInit } = await import('../commands/init.js')
    await cmdInit({ depth: 'all', llm: 'mock' })

    const decisions = readFileSync(join(root, '.lore', 'decisions.md'), 'utf8')
    expect(decisions).toContain('TypeScript')
  })

  it('creates .extraction-cache.json so commits are marked processed', async () => {
    const { cmdInit } = await import('../commands/init.js')
    await cmdInit({ depth: 'all', llm: 'mock' })

    expect(existsSync(join(root, '.lore', '.extraction-cache.json'))).toBe(true)
  })

  it('is idempotent — second run reports all commits already processed', async () => {
    const { cmdInit } = await import('../commands/init.js')
    await cmdInit({ depth: 'all', llm: 'mock' })

    // Capture all console output on the second run
    const chunks: string[] = []
    const origLog = console.log.bind(console)
    console.log = (...args: unknown[]) => chunks.push(args.join(' '))
    await cmdInit({ depth: 'all', llm: 'mock' })
    console.log = origLog

    expect(chunks.join(' ')).toMatch(/already processed|up to date|cache hit/i)
  })
})

// ── chronicle process ──────────────────────────────────────────────────────────

describe('chronicle process', () => {
  it('reports .lore/ is already up-to-date when all commits are cached from init', async () => {
    const { cmdInit } = await import('../commands/init.js')
    const { cmdProcess } = await import('../commands/process.js')

    await cmdInit({ depth: 'all', llm: 'mock' })

    const output = await captureStdout(() =>
      cmdProcess({ depth: 'all', llm: 'mock' })
    )

    // When all commits cached, process logs "already up-to-date"
    expect(output).toMatch(/already up-to-date|up-to-date/)
  })

  it('processes new commits added after init and appends to decisions.md', async () => {
    const { cmdInit } = await import('../commands/init.js')
    const { cmdProcess } = await import('../commands/process.js')

    await cmdInit({ depth: 'all', llm: 'mock' })

    const decisionsBefore = readFileSync(join(root, '.lore', 'decisions.md'), 'utf8')

    // Add a substantial new commit after init
    const git = (cmd: string) => execSync(cmd, { cwd: root, stdio: 'pipe' })
    writeFileSync(
      join(root, 'src', 'auth.ts'),
      [
        '// JWT auth module',
        'import jwt from "jsonwebtoken"',
        'const SECRET = process.env.JWT_SECRET!',
        'export function sign(payload: object): string {',
        '  return jwt.sign(payload, SECRET, { expiresIn: "7d" })',
        '}',
        'export function verify(token: string): object {',
        '  return jwt.verify(token, SECRET) as object',
        '}',
        'export function refresh(token: string): string {',
        '  return sign(verify(token))',
        '}',
        'export function decode(token: string) {',
        '  return jwt.decode(token)',
        '}',
        '// Refresh token rotation prevents replay attacks',
        'export type AuthPayload = { userId: string; iat: number; exp: number }',
        'export function isExpired(token: string): boolean {',
        '  try { verify(token); return false } catch { return true }',
        '}',
        'export function createServiceToken(service: string): string {',
        '  return sign({ service, type: "service" })',
        '}',
      ].join('\n')
    )
    git('git add .')
    git('git commit -m "feat: add JWT auth module with refresh rotation"')

    await cmdProcess({ depth: 'all', llm: 'mock' })

    // Mock LLM returns 1 decision per batch — decisions.md should grow
    const decisionsAfter = readFileSync(join(root, '.lore', 'decisions.md'), 'utf8')
    expect(decisionsAfter.length).toBeGreaterThan(decisionsBefore.length)
  })
})

// ── chronicle inject ───────────────────────────────────────────────────────────

describe('chronicle inject', () => {
  it('outputs context containing the decision from decisions.md', async () => {
    const { cmdInit } = await import('../commands/init.js')
    const { cmdInject } = await import('../commands/inject.js')

    await cmdInit({ depth: 'all', llm: 'mock' })

    const output = await captureStdout(() => cmdInject({ format: 'markdown', stale: false }))

    expect(output).toContain('TypeScript')
  })

  it('outputs valid XML when --format xml is specified', async () => {
    const { cmdInit } = await import('../commands/init.js')
    const { cmdInject } = await import('../commands/inject.js')

    await cmdInit({ depth: 'all', llm: 'mock' })

    const output = await captureStdout(() => cmdInject({ format: 'xml', stale: false }))

    expect(output).toMatch(/<chronicle|<decisions/i)
  })
})

// ── chronicle verify ───────────────────────────────────────────────────────────

describe('chronicle verify', () => {
  it('reports fresh=true and 0 unprocessed commits after init', async () => {
    const { cmdInit } = await import('../commands/init.js')
    const { cmdVerify } = await import('../commands/verify.js')

    await cmdInit({ depth: 'all', llm: 'mock' })

    const jsonOut = await captureStdout(() => cmdVerify({ maxLag: '5', json: true }))
    const result = JSON.parse(jsonOut)
    expect(result.fresh).toBe(true)
    expect(result.unprocessedCommits).toBe(0)
    expect(result.loreExists).toBe(true)
  })

  it('reports fresh=false and exits 1 when new commits exceed maxLag', async () => {
    const { cmdInit } = await import('../commands/init.js')
    const { cmdVerify } = await import('../commands/verify.js')

    await cmdInit({ depth: 'all', llm: 'mock' })

    // Add 6 substantial new commits — exceeds default maxLag of 5
    const git = (cmd: string) => execSync(cmd, { cwd: root, stdio: 'pipe' })
    for (let i = 1; i <= 6; i++) {
      writeFileSync(join(root, `feature-${i}.ts`), `// feature ${i}\n`.repeat(25))
      git('git add .')
      git(`git commit -m "feat: feature module ${i}"`)
    }

    let jsonOut = ''
    const exitCode = await withMockedExit(async () => {
      jsonOut = await captureStdout(() => cmdVerify({ maxLag: '5', json: true }))
    })

    const result = JSON.parse(jsonOut)
    expect(result.fresh).toBe(false)
    expect(result.unprocessedCommits).toBeGreaterThan(5)
    expect(exitCode).toBe(1)
  })
})
