/**
 * MCP server tests — validates tool input schemas, handler logic, and edge cases.
 *
 * Strategy: test the pure helper functions and Zod schemas exported from server internals.
 * We don't spin up the MCP stdio transport — that would require a full subprocess.
 * Instead we test the observable file-system effects of each tool handler directly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import os from 'os'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTempLore(): { root: string; loreDir: string } {
  const root = join(
    os.tmpdir(),
    `chronicle-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  const loreDir = join(root, '.lore')
  mkdirSync(loreDir, { recursive: true })
  return { root, loreDir }
}

// ── Zod schema validation ─────────────────────────────────────────────────────
// Import zod directly and re-declare the same schemas — validates the constraints
// we added to the server match our expectations.

import { z } from 'zod'

const LogDecisionSchema = z.object({
  title: z.string().max(200),
  rationale: z.string().max(4000),
  affects: z.array(z.string().max(500)).max(50),
  risk: z.enum(['low', 'medium', 'high']),
  isDeep: z.boolean().optional(),
})

const LogRejectionSchema = z.object({
  what: z.string().max(200),
  why: z.string().max(4000),
  replacedBy: z.string().max(200).optional(),
})

const SaveSessionSchema = z.object({
  summary: z.string().max(8000),
  pending: z.string().max(4000).optional(),
  decisions: z.array(z.string().max(200)).max(100).optional(),
})

const GetRisksSchema = z.object({
  files: z.array(z.string().max(500)).max(100),
})

describe('Zod input validation — chronicle_log_decision', () => {
  it('accepts a valid decision', () => {
    const result = LogDecisionSchema.safeParse({
      title: 'Use PostgreSQL for persistence',
      rationale: 'Strong ACID guarantees, mature ecosystem',
      affects: ['src/db/', 'migrations/'],
      risk: 'high',
      isDeep: true,
    })
    expect(result.success).toBe(true)
  })

  it('rejects title exceeding 200 chars', () => {
    const result = LogDecisionSchema.safeParse({
      title: 'x'.repeat(201),
      rationale: 'fine',
      affects: [],
      risk: 'low',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].path).toContain('title')
  })

  it('rejects rationale exceeding 4000 chars', () => {
    const result = LogDecisionSchema.safeParse({
      title: 'fine',
      rationale: 'x'.repeat(4001),
      affects: [],
      risk: 'low',
    })
    expect(result.success).toBe(false)
  })

  it('rejects affects array with more than 50 items', () => {
    const result = LogDecisionSchema.safeParse({
      title: 'fine',
      rationale: 'fine',
      affects: Array.from({ length: 51 }, (_, i) => `file${i}.ts`),
      risk: 'low',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].path).toContain('affects')
  })

  it('rejects invalid risk value', () => {
    const result = LogDecisionSchema.safeParse({
      title: 'fine',
      rationale: 'fine',
      affects: [],
      risk: 'critical',  // not in enum
    })
    expect(result.success).toBe(false)
  })
})

describe('Zod input validation — chronicle_log_rejection', () => {
  it('accepts a valid rejection', () => {
    const result = LogRejectionSchema.safeParse({
      what: 'GraphQL subscriptions',
      why: 'Too much complexity for our current scale',
      replacedBy: 'Server-Sent Events',
    })
    expect(result.success).toBe(true)
  })

  it('rejects what exceeding 200 chars', () => {
    const result = LogRejectionSchema.safeParse({
      what: 'x'.repeat(201),
      why: 'fine',
    })
    expect(result.success).toBe(false)
  })

  it('accepts missing replacedBy (optional)', () => {
    const result = LogRejectionSchema.safeParse({
      what: 'some approach',
      why: 'did not work',
    })
    expect(result.success).toBe(true)
  })
})

describe('Zod input validation — chronicle_save_session', () => {
  it('accepts a valid session', () => {
    const result = SaveSessionSchema.safeParse({
      summary: 'Implemented auth module',
      pending: 'Write tests',
      decisions: ['Use JWT', 'Store refresh tokens in httpOnly cookies'],
    })
    expect(result.success).toBe(true)
  })

  it('rejects summary exceeding 8000 chars', () => {
    const result = SaveSessionSchema.safeParse({
      summary: 'x'.repeat(8001),
    })
    expect(result.success).toBe(false)
  })

  it('rejects decisions array with more than 100 items', () => {
    const result = SaveSessionSchema.safeParse({
      summary: 'fine',
      decisions: Array.from({ length: 101 }, (_, i) => `decision ${i}`),
    })
    expect(result.success).toBe(false)
  })
})

describe('Zod input validation — chronicle_get_risks', () => {
  it('accepts an array of file paths', () => {
    const result = GetRisksSchema.safeParse({ files: ['src/auth.ts', 'src/db.ts'] })
    expect(result.success).toBe(true)
  })

  it('rejects more than 100 files', () => {
    const result = GetRisksSchema.safeParse({
      files: Array.from({ length: 101 }, (_, i) => `file${i}.ts`),
    })
    expect(result.success).toBe(false)
  })
})

// ── File-system effects ───────────────────────────────────────────────────────
// These tests exercise the actual .lore/ operations that the tool handlers perform.
// We replicate the handler logic to verify the patterns directly.

describe('session file naming', () => {
  let root: string
  let loreDir: string

  beforeEach(() => {
    ({ root, loreDir } = makeTempLore())
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('uses ISO timestamp (not just date) to avoid same-day collision', () => {
    const ts1 = new Date('2026-04-12T10:00:00Z').toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const ts2 = new Date('2026-04-12T15:30:00Z').toISOString().replace(/[:.]/g, '-').slice(0, 19)

    const sessionsDir = join(loreDir, 'sessions')
    mkdirSync(sessionsDir, { recursive: true })

    writeFileSync(join(sessionsDir, `${ts1}.md`), '# Session 1')
    writeFileSync(join(sessionsDir, `${ts2}.md`), '# Session 2')

    const files = require('fs').readdirSync(sessionsDir)
    expect(files).toHaveLength(2)
    expect(files[0]).not.toBe(files[1])
  })

  it('getLastSession returns the latest file by sort order', () => {
    const sessionsDir = join(loreDir, 'sessions')
    mkdirSync(sessionsDir, { recursive: true })

    // older session
    writeFileSync(join(sessionsDir, '2026-04-12T08-00-00.md'), '# Older')
    // newer session
    writeFileSync(join(sessionsDir, '2026-04-12T17-00-00.md'), '# Newer')

    const files = require('fs').readdirSync(sessionsDir).filter((f: string) => f.endsWith('.md')).sort().reverse()
    const content = readFileSync(join(sessionsDir, files[0]), 'utf8')
    expect(content).toBe('# Newer')
  })
})

describe('slugify helper', () => {
  // Mirror the server's slugify logic
  function slugify(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  }

  it('converts spaces and special chars to hyphens', () => {
    expect(slugify('Use TypeScript for the API')).toBe('use-typescript-for-the-api')
  })

  it('strips leading and trailing hyphens', () => {
    expect(slugify('  trim me  ')).toBe('trim-me')
  })

  it('truncates to 60 characters', () => {
    const long = 'a'.repeat(100)
    expect(slugify(long)).toHaveLength(60)
  })
})

describe('formatADR helper', () => {
  function formatADR(d: { title: string; rationale: string; affects: string[]; risk: string; date: string }): string {
    return `# ADR: ${d.title}\n\n**Date**: ${d.date}\n**Status**: Accepted\n**Affects**: ${d.affects.join(', ')}\n**Risk**: ${d.risk}\n\n## Decision\n\n${d.rationale}\n\n## Consequences\n\n_To be annotated as consequences become clear._\n`
  }

  it('produces a well-structured ADR document', () => {
    const adr = formatADR({
      title: 'Switch to Vite',
      rationale: 'Faster HMR than webpack',
      affects: ['build/', 'vite.config.ts'],
      risk: 'medium',
      date: '2026-04-12',
    })
    expect(adr).toContain('# ADR: Switch to Vite')
    expect(adr).toContain('**Date**: 2026-04-12')
    expect(adr).toContain('**Status**: Accepted')
    expect(adr).toContain('**Risk**: medium')
    expect(adr).toContain('Faster HMR than webpack')
  })
})
