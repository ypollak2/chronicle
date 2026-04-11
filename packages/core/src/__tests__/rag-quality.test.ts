/**
 * RAG Quality tests — the most important test layer.
 *
 * These tests answer: "Does Chronicle capture the RIGHT knowledge?"
 * Not "does the code run" but "does the RAG contain what matters":
 *   - Architecture-level changes (not just individual commits)
 *   - Security and risk information
 *   - Rejected approaches (prevents future repetition)
 *   - Evolution of the system over time
 *   - Correct inject output structure for AI consumption
 *
 * Tests use pre-populated .lore/ fixtures (no LLM required) so they
 * run deterministically in CI. The quality of the fixture data represents
 * what well-functioning LLM extraction would produce.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { buildPopulatedLore } from './fixtures.js'
import {
  readStore, initStore, lorePath, writeStore,
  rankDecisions, parseDecisionsTable, estimateTokens,
  buildFileModMap, annotateStaleDecisions,
  parseRelations, buildRelationGraph, addRelationToRow,
  readContext, formatContextForInject, addContextFact,
  loadOwnership, getOwnersForFile,
} from '../index.js'

function makeTempDir() {
  const dir = join(os.tmpdir(), `chronicle-rag-quality-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('RAG Quality — Document Completeness', () => {
  let root: string

  beforeEach(() => {
    root = makeTempDir()
    buildPopulatedLore(root)
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  // ── decisions.md ──────────────────────────────────────────────────────────

  describe('decisions.md', () => {
    it('captures feature decisions (JWT auth)', () => {
      const decisions = readStore(root, 'decisions')
      expect(decisions).toContain('JWT')
      expect(decisions).toContain('src/auth/')
    })

    it('captures architecture-level decisions with isDeep marker', () => {
      const decisions = readStore(root, 'decisions')
      // Deep decisions have a link to a detailed ADR
      expect(decisions).toContain('[→](decisions/microservices-migration.md)')
    })

    it('captures security decisions with high risk', () => {
      const decisions = readStore(root, 'decisions')
      expect(decisions).toContain('timing attack')
      const rows = decisions.split('\n').filter(l => l.includes('timing attack'))
      expect(rows[0]).toContain('high')
    })

    it('stores author attribution on decisions', () => {
      const decisions = readStore(root, 'decisions')
      expect(decisions).toContain('<!-- author:')
    })

    it('has a parseable table structure', () => {
      const decisions = readStore(root, 'decisions')
      const { rows } = parseDecisionsTable(decisions)
      expect(rows.length).toBeGreaterThanOrEqual(3)
      // Every row should have at least 4 pipe-separated columns
      for (const { line } of rows) {
        const cols = line.split('|').filter(Boolean)
        expect(cols.length).toBeGreaterThanOrEqual(4)
      }
    })

    it('has confidence scores on decisions', () => {
      const decisions = readStore(root, 'decisions')
      const matches = [...decisions.matchAll(/<!-- confidence:([\d.]+) -->/g)]
      expect(matches.length).toBeGreaterThanOrEqual(3)
      // All confidence scores should be between 0 and 1
      for (const m of matches) {
        const score = parseFloat(m[1])
        expect(score).toBeGreaterThan(0)
        expect(score).toBeLessThanOrEqual(1)
      }
    })
  })

  // ── rejected.md ───────────────────────────────────────────────────────────

  describe('rejected.md', () => {
    it('contains rejected approaches to prevent future repetition', () => {
      const rejected = readStore(root, 'rejected')
      expect(rejected).toContain('GraphQL')
      expect(rejected).toContain('Redis')
    })

    it('each rejection has a reason explaining why it was abandoned', () => {
      const rejected = readStore(root, 'rejected')
      expect(rejected).toContain('Reason')
      expect(rejected.toLowerCase()).toContain('velocity')
    })

    it('each rejection names what replaced the approach', () => {
      const rejected = readStore(root, 'rejected')
      expect(rejected).toContain('Replaced by')
    })
  })

  // ── risks.md ──────────────────────────────────────────────────────────────

  describe('risks.md', () => {
    it('flags high blast-radius files', () => {
      const risks = readStore(root, 'risks')
      expect(risks).toContain('src/auth/jwt.ts')
      expect(risks).toContain('src/db/pool.ts')
    })

    it('explains WHY each file is high risk', () => {
      const risks = readStore(root, 'risks')
      // Should explain risk, not just list files
      expect(risks.length).toBeGreaterThan(200)
      const lines = risks.split('\n').filter(l => l.includes('src/auth/jwt.ts'))
      expect(lines[0].length).toBeGreaterThan(30)
    })

    it('covers security-critical files', () => {
      const risks = readStore(root, 'risks')
      expect(risks).toContain('middleware.ts')
    })
  })

  // ── evolution.md ──────────────────────────────────────────────────────────

  describe('evolution.md', () => {
    it('reflects architectural phases', () => {
      const evolution = readStore(root, 'evolution')
      expect(evolution).toContain('Phase')
      expect(evolution).toContain('Microservices')
    })

    it('has multiple eras for a mature project', () => {
      const evolution = readStore(root, 'evolution')
      const eras = evolution.split('---').filter(e => e.trim())
      expect(eras.length).toBeGreaterThanOrEqual(2)
    })

    it('tracks most-changed files per era', () => {
      const evolution = readStore(root, 'evolution')
      expect(evolution).toContain('services/')
    })

    it('includes date ranges for each era', () => {
      const evolution = readStore(root, 'evolution')
      // Each era should have a date range
      const datePattern = /\d{4}-\d{2}-\d{2}/g
      const dates = evolution.match(datePattern)
      expect(dates).toBeTruthy()
      expect(dates!.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ── Deep ADR ──────────────────────────────────────────────────────────────

  describe('deep ADR files (decisions/<slug>.md)', () => {
    it('exists for complex architecture decisions', () => {
      const adrPath = lorePath(root, 'decisions', 'microservices-migration.md')
      expect(existsSync(adrPath)).toBe(true)
    })

    it('contains context, decision, and consequences sections', () => {
      const content = readFileSync(lorePath(root, 'decisions', 'microservices-migration.md'), 'utf8')
      expect(content).toContain('## Context')
      expect(content).toContain('## Decision')
      expect(content).toContain('## Consequences')
    })

    it('lists alternatives considered to prevent future re-evaluation', () => {
      const content = readFileSync(lorePath(root, 'decisions', 'microservices-migration.md'), 'utf8')
      expect(content).toContain('Alternatives Considered')
    })
  })
})

// ─── RAG Quality — Inject Output ─────────────────────────────────────────────

describe('RAG Quality — Inject Output Structure', () => {
  let root: string

  beforeEach(() => {
    root = makeTempDir()
    buildPopulatedLore(root)
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('inject contains decisions for the scoped files', () => {
    const decisions = readStore(root, 'decisions')
    // Simulate inject file scoping: filter to auth/ related decisions
    const { rows } = parseDecisionsTable(decisions)
    const authRows = rows.filter(r => r.line.includes('auth'))
    expect(authRows.length).toBeGreaterThanOrEqual(2)
  })

  it('ranking puts high-risk recent decisions first', () => {
    const decisions = readStore(root, 'decisions')
    const ranked = rankDecisions(decisions, {
      files: ['src/auth/middleware.ts'],
      topN: 2,
    })
    // The security decision (high risk, auth-related) should appear in top 2
    expect(ranked).toContain('auth')
  })

  it('staleness detection flags outdated decisions correctly', () => {
    // Use an old decision date so it clears the MIN_DECISION_AGE_DAYS threshold
    writeStore(root, 'decisions', `# Architecture Decisions

| Date | Decision | Affects | Risk |
|------|----------|---------|------|
| 2024-01-15 | Use JWT for authentication | src/auth/jwt.ts | high | <!-- confidence:0.92 -->
`)
    const modMap = new Map<string, number>()
    modMap.set('src/auth/jwt.ts', Date.now())  // recently modified — makes the 2024 decision stale

    const decisions = readStore(root, 'decisions')
    const { annotated } = annotateStaleDecisions(decisions, modMap)
    expect(annotated).toContain('stale')
  })

  it('inject output is token-efficient: decisions.md alone is under 4000 tokens', () => {
    const decisions = readStore(root, 'decisions')
    const tokenCount = estimateTokens(decisions)
    expect(tokenCount).toBeLessThan(4000)
  })
})

// ─── RAG Quality — Relations & Context (v0.9.0) ──────────────────────────────

describe('RAG Quality — Relations DAG', () => {
  let root: string

  beforeEach(() => {
    root = makeTempDir()
    buildPopulatedLore(root)
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('relations can be added to a decision row', () => {
    const row = '| 2026-04-01 | Use JWT auth | src/auth/ | high |'
    const updated = addRelationToRow(row, 'supersedes', 'Redis session store')
    const rels = parseRelations(updated)
    expect(rels.supersedes).toContain('Redis session store')
  })

  it('relation graph can be built from decisions.md', () => {
    writeStore(root, 'decisions', `# Decisions

| Date | Decision | Affects | Risk |
|------|----------|---------|------|
| 2026-04-01 | Use JWT auth | src/auth/ | high | <!-- relations:{"supersedes":["Redis sessions"]} -->
| 2026-04-03 | Microservices migration | services/ | high | <!-- relations:{"dependsOn":["Use JWT auth"]} -->
`)
    const decisions = readStore(root, 'decisions')
    const graph = buildRelationGraph(decisions)
    expect(graph.size).toBe(2)
    expect(graph.get('Use JWT auth')?.supersedes).toContain('Redis sessions')
    expect(graph.get('Microservices migration')?.dependsOn).toContain('Use JWT auth')
  })
})

describe('RAG Quality — Business Context', () => {
  let root: string

  beforeEach(() => {
    root = makeTempDir()
    initStore(root)
    addContextFact(root, 'goals', 'Build reliable authentication for 10k users')
    addContextFact(root, 'constraints', 'No Redis dependency — stateless only')
    addContextFact(root, 'stack', 'TypeScript, Node 20, PostgreSQL')
    addContextFact(root, 'nonGoals', 'Not building SSO or SAML')
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('context is readable and parseable', () => {
    const ctx = readContext(root)
    expect(ctx.goals).toContain('Build reliable authentication for 10k users')
    expect(ctx.constraints).toContain('No Redis dependency — stateless only')
    expect(ctx.nonGoals).toContain('Not building SSO or SAML')
  })

  it('formatContextForInject produces AI-readable output', () => {
    const ctx = readContext(root)
    const formatted = formatContextForInject(ctx)
    expect(formatted).toContain('## Goals')
    expect(formatted).toContain('## Constraints')
    expect(formatted).toContain('## Non-Goals')
    expect(formatted).not.toContain('(none)')
  })

  it('context is prepended in inject output (highest priority position)', () => {
    const ctx = readContext(root)
    const formatted = formatContextForInject(ctx)
    // Context block should appear before any decision tables
    expect(formatted.indexOf('# Project Context')).toBe(0)
  })
})
