/**
 * Eval command tests — KPI runners, init, JSON output, and exit behaviour
 *
 * Tests run against a synthetic .lore/ fixture with deterministic content so
 * results are stable regardless of LLM output or embeddings availability.
 *
 * Coverage:
 *  - initEvalSuite: bootstraps .eval.json from existing decisions/rejections
 *  - Decision Recall KPI: substring search in decisions.md
 *  - Rejection Hit Rate KPI: substring search in rejected.md
 *  - False Confidence Rate KPI: stale decisions without ⚠️ annotation
 *  - Semantic MRR KPI: graceful skip when embeddings unavailable
 *  - JSON output mode: machine-readable KPI results
 *  - Exit code 1 when any KPI is below target
 *  - Edge cases: missing eval file, empty decisions, idempotent init
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import os from 'os'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTempLore(): { root: string; loreDir: string } {
  const root = join(
    os.tmpdir(),
    `chronicle-eval-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  const loreDir = join(root, '.lore')
  mkdirSync(loreDir, { recursive: true })
  return { root, loreDir }
}

const DECISIONS_MD = `# Decision Log

| Date | Decision | Affects | Risk | ADR |
|------|----------|---------|------|-----|
| 2026-01-10 | Use TypeScript for type safety | src/ | medium |  |
| 2026-02-15 | PostgreSQL for persistent storage | src/db/ | high |  |
| 2026-03-01 | JWT authentication with refresh rotation | src/auth/ | high |  |
| 2026-03-20 | Redis for session caching | src/cache/ | medium |  |
| 2026-04-01 | Vite over Webpack for build tooling | build/ | low |  |
`

const REJECTED_MD = `# Rejected Approaches

## GraphQL subscriptions — rejected 2026-02-01
**Replaced by**: Server-Sent Events

Too much complexity for our current scale. We'd need a dedicated WebSocket server,
and our traffic patterns don't justify the operational overhead.

## MongoDB — rejected 2026-01-15
**Replaced by**: PostgreSQL

Inconsistent ACID guarantees caused data integrity issues in staging.
`

const RISKS_MD = `# Risk Register

| File | Risk | Decision |
|------|------|----------|
| src/auth/ | high | JWT authentication with refresh rotation |
| src/db/ | high | PostgreSQL for persistent storage |
`

/** Create a minimal eval suite with known test cases */
function buildEvalSuite(root: string, overrides: Partial<{ decisions: number; rejections: number; failing: boolean }> = {}) {
  const loreDir = join(root, '.lore')
  writeFileSync(join(loreDir, 'decisions.md'), DECISIONS_MD)
  writeFileSync(join(loreDir, 'rejected.md'), REJECTED_MD)
  writeFileSync(join(loreDir, 'risks.md'), RISKS_MD)

  // Populate eval suite
  const decisionCases = Array.from({ length: overrides.decisions ?? 3 }, (_, i) => ({
    id: `decision-${i + 1}`,
    type: 'decision_recall',
    query: ['TypeScript', 'PostgreSQL', 'JWT authentication', 'Redis', 'Vite'][i],
    expectedText: ['TypeScript', 'PostgreSQL', 'JWT', 'Redis', 'Vite'][i],
    description: `Case ${i + 1}`,
  }))

  const rejectionCases = Array.from({ length: overrides.rejections ?? 2 }, (_, i) => ({
    id: `rejection-${i + 1}`,
    type: 'rejection_hit',
    query: ['GraphQL', 'MongoDB'][i],
    expectedText: overrides.failing ? `NOTFOUND_${i}` : ['GraphQL', 'MongoDB'][i],
    description: `Rejection case ${i + 1}`,
  }))

  const suite = {
    version: '0.7.0',
    generated: new Date().toISOString(),
    cases: [...decisionCases, ...rejectionCases],
  }

  writeFileSync(join(loreDir, '.eval.json'), JSON.stringify(suite, null, 2))
  return suite
}

/** Capture stdout + stderr from an async fn */
async function capture(fn: () => Promise<void>): Promise<{ stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''
  const origStdout = process.stdout.write.bind(process.stdout)
  const origStderr = process.stderr.write.bind(process.stderr)
  const origLog = console.log.bind(console)
  const origErr = console.error.bind(console)

  ;(process.stdout as NodeJS.WriteStream & { write: unknown }).write = ((chunk: unknown) => {
    stdout += String(chunk); return true
  }) as never
  ;(process.stderr as NodeJS.WriteStream & { write: unknown }).write = ((chunk: unknown) => {
    stderr += String(chunk); return true
  }) as never
  console.log = (...args: unknown[]) => { stdout += args.map(a => String(a)).join(' ') + '\n' }
  console.error = (...args: unknown[]) => { stderr += args.map(a => String(a)).join(' ') + '\n' }

  try { await fn() } catch { /* captured */ }
  finally {
    process.stdout.write = origStdout
    process.stderr.write = origStderr
    console.log = origLog
    console.error = origErr
  }
  return { stdout, stderr }
}

/** Run fn(), capture the exit code if process.exit is called */
async function withMockedExit(fn: () => Promise<void>): Promise<number | undefined> {
  let code: number | undefined
  const orig = process.exit.bind(process)
  ;(process.exit as (code?: number) => never) = ((c?: number) => { code = c }) as never
  try { await fn() } catch { /* ignore */ }
  finally { process.exit = orig }
  return code
}

// ── Tests ──────────────────────────────────────────────────────────────────────

let root: string
let loreDir: string
const originalCwd = process.cwd()

beforeEach(() => {
  ({ root, loreDir } = makeTempLore())
  process.chdir(root)
  // Create .git so findLoreRoot can find .lore
  mkdirSync(join(root, '.git'), { recursive: true })
})

afterEach(() => {
  process.chdir(originalCwd)
  rmSync(root, { recursive: true, force: true })
})

// ── chronicle eval --init ──────────────────────────────────────────────────────

describe('chronicle eval --init', () => {
  it('creates .eval.json from existing decisions and rejections', async () => {
    writeFileSync(join(loreDir, 'decisions.md'), DECISIONS_MD)
    writeFileSync(join(loreDir, 'rejected.md'), REJECTED_MD)

    const { cmdEval } = await import('../commands/eval.js')
    await cmdEval({ init: true, json: false, verbose: false })

    const evalPath = join(loreDir, '.eval.json')
    expect(existsSync(evalPath)).toBe(true)
  })

  it('bootstrapped suite contains decision_recall cases', async () => {
    writeFileSync(join(loreDir, 'decisions.md'), DECISIONS_MD)
    writeFileSync(join(loreDir, 'rejected.md'), REJECTED_MD)

    const { cmdEval } = await import('../commands/eval.js')
    await cmdEval({ init: true, json: false, verbose: false })

    const suite = JSON.parse(readFileSync(join(loreDir, '.eval.json'), 'utf8'))
    const decisionCases = suite.cases.filter((c: { type: string }) => c.type === 'decision_recall')
    expect(decisionCases.length).toBeGreaterThan(0)
    expect(decisionCases.length).toBeLessThanOrEqual(10)
  })

  it('bootstrapped suite contains rejection_hit cases', async () => {
    writeFileSync(join(loreDir, 'decisions.md'), DECISIONS_MD)
    writeFileSync(join(loreDir, 'rejected.md'), REJECTED_MD)

    const { cmdEval } = await import('../commands/eval.js')
    await cmdEval({ init: true, json: false, verbose: false })

    const suite = JSON.parse(readFileSync(join(loreDir, '.eval.json'), 'utf8'))
    const rejectionCases = suite.cases.filter((c: { type: string }) => c.type === 'rejection_hit')
    expect(rejectionCases.length).toBeGreaterThan(0)
  })

  it('is idempotent — second --init does not overwrite existing suite', async () => {
    writeFileSync(join(loreDir, 'decisions.md'), DECISIONS_MD)
    writeFileSync(join(loreDir, 'rejected.md'), REJECTED_MD)

    const { cmdEval } = await import('../commands/eval.js')
    await cmdEval({ init: true, json: false, verbose: false })

    const first = readFileSync(join(loreDir, '.eval.json'), 'utf8')

    // Add more decisions — second init should NOT overwrite
    writeFileSync(join(loreDir, 'decisions.md'), DECISIONS_MD + '| 2026-05-01 | New decision | new/ | low | |\n')
    await cmdEval({ init: true, json: false, verbose: false })

    const second = readFileSync(join(loreDir, '.eval.json'), 'utf8')
    expect(second).toBe(first)  // unchanged
  })

  it('handles empty decisions.md gracefully', async () => {
    writeFileSync(join(loreDir, 'decisions.md'), '# Decision Log\n\n| Date | Decision | Affects | Risk | ADR |\n|------|----------|---------|------|-----|\n')
    writeFileSync(join(loreDir, 'rejected.md'), '')

    const { cmdEval } = await import('../commands/eval.js')
    // Should not throw — creates a suite with 0 cases
    await expect(cmdEval({ init: true, json: false, verbose: false })).resolves.not.toThrow()

    const suite = JSON.parse(readFileSync(join(loreDir, '.eval.json'), 'utf8'))
    expect(suite.cases).toHaveLength(0)
  })
})

// ── Decision Recall KPI ───────────────────────────────────────────────────────

describe('Decision Recall KPI', () => {
  it('reports 100% recall when all expected decisions are present', async () => {
    buildEvalSuite(root)

    const { cmdEval } = await import('../commands/eval.js')
    const { stdout } = await capture(() => cmdEval({ init: false, json: true, verbose: false }))
    const results = JSON.parse(stdout)

    const decisionKpi = results.find((r: { name: string }) => r.name === 'Decision Recall')
    expect(decisionKpi).toBeDefined()
    expect(decisionKpi.score).toBe(1.0)
    expect(decisionKpi.passing).toBe(true)
  })

  it('reports partial recall when some decisions are missing', async () => {
    buildEvalSuite(root)

    // Remove one decision from decisions.md so one case fails
    const decisions = readFileSync(join(loreDir, 'decisions.md'), 'utf8')
    writeFileSync(join(loreDir, 'decisions.md'), decisions.replace(/.*TypeScript.*\n/, ''))

    const { cmdEval } = await import('../commands/eval.js')
    const { stdout } = await capture(() => cmdEval({ init: false, json: true, verbose: false }))
    const results = JSON.parse(stdout)

    const decisionKpi = results.find((r: { name: string }) => r.name === 'Decision Recall')
    expect(decisionKpi.score).toBeLessThan(1.0)
  })

  it('reports passing=false when recall drops below 80% target', async () => {
    // 3 decision cases, 1 found = 33% recall — below 80%
    const failingSuite = {
      version: '0.7.0',
      generated: new Date().toISOString(),
      cases: [
        { id: 'd1', type: 'decision_recall', query: 'TypeScript', expectedText: 'TypeScript' },
        { id: 'd2', type: 'decision_recall', query: 'missing-tech', expectedText: 'NOTFOUND_ONE' },
        { id: 'd3', type: 'decision_recall', query: 'another missing', expectedText: 'NOTFOUND_TWO' },
      ],
    }
    writeFileSync(join(loreDir, 'decisions.md'), DECISIONS_MD)
    writeFileSync(join(loreDir, 'rejected.md'), '')
    writeFileSync(join(loreDir, '.eval.json'), JSON.stringify(failingSuite, null, 2))

    const { cmdEval } = await import('../commands/eval.js')
    const { stdout } = await capture(() => cmdEval({ init: false, json: true, verbose: false }))
    const results = JSON.parse(stdout)

    const decisionKpi = results.find((r: { name: string }) => r.name === 'Decision Recall')
    expect(decisionKpi.passing).toBe(false)
    expect(decisionKpi.score).toBeCloseTo(1 / 3)
  })
})

// ── Rejection Hit Rate KPI ────────────────────────────────────────────────────

describe('Rejection Hit Rate KPI', () => {
  it('reports 100% hit rate when all rejections are present', async () => {
    buildEvalSuite(root)

    const { cmdEval } = await import('../commands/eval.js')
    const { stdout } = await capture(() => cmdEval({ init: false, json: true, verbose: false }))
    const results = JSON.parse(stdout)

    const rejKpi = results.find((r: { name: string }) => r.name === 'Rejection Hit Rate')
    expect(rejKpi).toBeDefined()
    expect(rejKpi.score).toBe(1.0)
    expect(rejKpi.passing).toBe(true)
  })

  it('reports failing when expected rejection text is absent', async () => {
    buildEvalSuite(root, { failing: true })

    const { cmdEval } = await import('../commands/eval.js')
    const { stdout } = await capture(() => cmdEval({ init: false, json: true, verbose: false }))
    const results = JSON.parse(stdout)

    const rejKpi = results.find((r: { name: string }) => r.name === 'Rejection Hit Rate')
    expect(rejKpi.score).toBe(0)
    expect(rejKpi.passing).toBe(false)
  })
})

// ── False Confidence Rate KPI ─────────────────────────────────────────────────

describe('False Confidence Rate KPI', () => {
  it('reports 0% false confidence when no stale decisions exist', async () => {
    buildEvalSuite(root)

    const { cmdEval } = await import('../commands/eval.js')
    const { stdout } = await capture(() => cmdEval({ init: false, json: true, verbose: false }))
    const results = JSON.parse(stdout)

    const fcKpi = results.find((r: { name: string }) => r.name === 'False Confidence Rate')
    expect(fcKpi).toBeDefined()
    // Score 0 means no unannotated stale decisions — always passes
    expect(fcKpi.passing).toBe(true)
  })

  it('is always included in results even with empty decisions', async () => {
    writeFileSync(join(loreDir, 'decisions.md'), '# Decision Log\n\n| Date | Decision | Affects | Risk | ADR |\n|------|----------|---------|------|-----|\n')
    writeFileSync(join(loreDir, 'rejected.md'), '')
    writeFileSync(join(loreDir, '.eval.json'), JSON.stringify({ version: '0.7.0', generated: new Date().toISOString(), cases: [] }))

    const { cmdEval } = await import('../commands/eval.js')
    const { stdout } = await capture(() => cmdEval({ init: false, json: true, verbose: false }))
    const results = JSON.parse(stdout)

    const fcKpi = results.find((r: { name: string }) => r.name === 'False Confidence Rate')
    expect(fcKpi).toBeDefined()
  })
})

// ── Semantic MRR KPI ──────────────────────────────────────────────────────────

describe('Semantic MRR@5 KPI', () => {
  it('skips gracefully when @huggingface/transformers not installed', async () => {
    const suite = {
      version: '0.7.0',
      generated: new Date().toISOString(),
      cases: [
        { id: 's1', type: 'semantic_mrr', query: 'why did we choose TypeScript', expectedText: 'TypeScript' },
      ],
    }
    writeFileSync(join(loreDir, 'decisions.md'), DECISIONS_MD)
    writeFileSync(join(loreDir, 'rejected.md'), REJECTED_MD)
    writeFileSync(join(loreDir, '.eval.json'), JSON.stringify(suite))

    const { cmdEval } = await import('../commands/eval.js')
    const { stdout } = await capture(() => cmdEval({ init: false, json: true, verbose: false }))
    const results = JSON.parse(stdout)

    const mrrKpi = results.find((r: { name: string }) => r.name === 'Semantic MRR@5')
    expect(mrrKpi).toBeDefined()
    // When embeddings unavailable: score = -1, passing = true (skip, not failure)
    expect(mrrKpi.score).toBe(-1)
    expect(mrrKpi.passing).toBe(true)
    expect(mrrKpi.details).toContain('skipped')
  })
})

// ── Exit codes and output ──────────────────────────────────────────────────────

describe('exit codes and output format', () => {
  it('exits 0 when all KPIs pass', async () => {
    buildEvalSuite(root)

    const { cmdEval } = await import('../commands/eval.js')
    const exitCode = await withMockedExit(async () => {
      await capture(() => cmdEval({ init: false, json: false, verbose: false }))
    })

    // exit should not be called at all (0 failures) — undefined means no process.exit
    expect(exitCode).toBeUndefined()
  })

  it('exits 1 when a KPI fails', async () => {
    buildEvalSuite(root, { failing: true })

    const { cmdEval } = await import('../commands/eval.js')
    const exitCode = await withMockedExit(async () => {
      await capture(() => cmdEval({ init: false, json: false, verbose: false }))
    })

    expect(exitCode).toBe(1)
  })

  it('exits 1 when no .eval.json found', async () => {
    writeFileSync(join(loreDir, 'decisions.md'), DECISIONS_MD)

    const { cmdEval } = await import('../commands/eval.js')
    const exitCode = await withMockedExit(async () => {
      await capture(() => cmdEval({ init: false, json: false, verbose: false }))
    })

    expect(exitCode).toBe(1)
  })

  it('--json flag outputs valid JSON array of KPIResult objects', async () => {
    buildEvalSuite(root)

    const { cmdEval } = await import('../commands/eval.js')
    const { stdout } = await capture(() => cmdEval({ init: false, json: true, verbose: false }))

    expect(() => JSON.parse(stdout)).not.toThrow()
    const results = JSON.parse(stdout)
    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBeGreaterThan(0)

    // Each result has required KPIResult shape
    for (const r of results) {
      expect(r).toHaveProperty('name')
      expect(r).toHaveProperty('score')
      expect(r).toHaveProperty('target')
      expect(r).toHaveProperty('passing')
      expect(r).toHaveProperty('details')
      expect(typeof r.passing).toBe('boolean')
      expect(typeof r.score).toBe('number')
    }
  })

  it('human-readable output contains KPI names and scores', async () => {
    buildEvalSuite(root)

    const { cmdEval } = await import('../commands/eval.js')
    const { stdout } = await capture(() => cmdEval({ init: false, json: false, verbose: false }))

    expect(stdout).toMatch(/Decision Recall/)
    expect(stdout).toMatch(/Rejection Hit Rate/)
    expect(stdout).toMatch(/False Confidence Rate/)
    expect(stdout).toMatch(/\d+\.\d+%/)  // contains a percentage
  })

  it('--verbose flag shows miss details', async () => {
    buildEvalSuite(root, { failing: true })

    const { cmdEval } = await import('../commands/eval.js')
    const { stdout } = await capture(() => cmdEval({ init: false, json: false, verbose: true }))

    // verbose mode shows miss ids
    expect(stdout).toMatch(/miss|NOTFOUND/i)
  })
})

// ── RAG quality baseline assertions ──────────────────────────────────────────
// These tests assert the minimum acceptable quality bar for the Chronicle RAG system.
// They run against synthetic content where ground truth is known.

describe('RAG quality baseline', () => {
  it('decision recall ≥ 80% on a well-formed decisions.md', async () => {
    // 5 cases, all expected text present in decisions.md — should be 100%
    const suite = {
      version: '0.7.0',
      generated: new Date().toISOString(),
      cases: [
        { id: 'd1', type: 'decision_recall', query: 'TypeScript', expectedText: 'TypeScript' },
        { id: 'd2', type: 'decision_recall', query: 'PostgreSQL', expectedText: 'PostgreSQL' },
        { id: 'd3', type: 'decision_recall', query: 'JWT', expectedText: 'JWT' },
        { id: 'd4', type: 'decision_recall', query: 'Redis', expectedText: 'Redis' },
        { id: 'd5', type: 'decision_recall', query: 'Vite', expectedText: 'Vite' },
      ],
    }
    writeFileSync(join(loreDir, 'decisions.md'), DECISIONS_MD)
    writeFileSync(join(loreDir, 'rejected.md'), REJECTED_MD)
    writeFileSync(join(loreDir, '.eval.json'), JSON.stringify(suite))

    const { cmdEval } = await import('../commands/eval.js')
    const { stdout } = await capture(() => cmdEval({ init: false, json: true, verbose: false }))
    const results = JSON.parse(stdout)

    const decisionKpi = results.find((r: { name: string }) => r.name === 'Decision Recall')
    expect(decisionKpi.score).toBeGreaterThanOrEqual(0.80)
    expect(decisionKpi.passing).toBe(true)
  })

  it('rejection hit rate ≥ 90% on a well-formed rejected.md', async () => {
    const suite = {
      version: '0.7.0',
      generated: new Date().toISOString(),
      cases: [
        { id: 'r1', type: 'rejection_hit', query: 'GraphQL', expectedText: 'GraphQL' },
        { id: 'r2', type: 'rejection_hit', query: 'MongoDB', expectedText: 'MongoDB' },
      ],
    }
    writeFileSync(join(loreDir, 'decisions.md'), DECISIONS_MD)
    writeFileSync(join(loreDir, 'rejected.md'), REJECTED_MD)
    writeFileSync(join(loreDir, '.eval.json'), JSON.stringify(suite))

    const { cmdEval } = await import('../commands/eval.js')
    const { stdout } = await capture(() => cmdEval({ init: false, json: true, verbose: false }))
    const results = JSON.parse(stdout)

    const rejKpi = results.find((r: { name: string }) => r.name === 'Rejection Hit Rate')
    expect(rejKpi.score).toBeGreaterThanOrEqual(0.90)
    expect(rejKpi.passing).toBe(true)
  })

  it('false confidence rate ≤ 10% when decisions have no stale paths', async () => {
    // All decisions reference paths that don't exist on disk → modMap will be empty
    // → annotateStaleDecisions marks nothing as stale → falseConfidenceRate = 0
    buildEvalSuite(root)

    const { cmdEval } = await import('../commands/eval.js')
    const { stdout } = await capture(() => cmdEval({ init: false, json: true, verbose: false }))
    const results = JSON.parse(stdout)

    const fcKpi = results.find((r: { name: string }) => r.name === 'False Confidence Rate')
    expect(fcKpi.score).toBeLessThanOrEqual(0.10)
    expect(fcKpi.passing).toBe(true)
  })

  it('all KPIs pass simultaneously on a healthy .lore/ fixture', async () => {
    buildEvalSuite(root)

    const { cmdEval } = await import('../commands/eval.js')
    const exitCode = await withMockedExit(async () => {
      await capture(() => cmdEval({ init: false, json: false, verbose: false }))
    })

    // No failing KPIs → process.exit not called
    expect(exitCode).toBeUndefined()
  })
})
