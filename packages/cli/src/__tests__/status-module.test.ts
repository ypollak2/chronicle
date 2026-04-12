import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { initStore, writeStore } from '@chronicle/core'
import { getStoreStats } from '../status.js'

function makeTempDir(): string {
  const dir = join(os.tmpdir(), `chronicle-status-module-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('getStoreStats', () => {
  let root: string

  beforeEach(() => {
    root = makeTempDir()
    initStore(root)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('returns zeroes for an empty store', () => {
    writeStore(root, 'decisions', '# Decision Log\n\n')
    writeStore(root, 'rejected', '')
    const stats = getStoreStats(root)
    expect(stats.decisions).toBe(0)
    expect(stats.rejections).toBe(0)
    expect(stats.deepADRs).toBe(0)
    expect(stats.sessions).toBe(0)
  })

  it('counts table rows in decisions.md', () => {
    writeStore(root, 'decisions', [
      '# Decision Log',
      '',
      '| Date | Decision | Affects | Risk |',
      '|------|----------|---------|------|',
      '| 2024-01-01 | Use JWT | src/ | high |',
      '| 2024-01-02 | Add Redis | cache/ | medium |',
      '| 2024-01-03 | Migrate DB | db/ | low |',
    ].join('\n'))
    const stats = getStoreStats(root)
    expect(stats.decisions).toBe(3)
  })

  it('counts headings in rejected.md', () => {
    writeStore(root, 'rejected', [
      '# Rejected',
      '',
      '## GraphQL (2024-01-01)',
      'Reason: too complex',
      '',
      '## REST v2 (2024-01-02)',
      'Reason: breaking changes',
    ].join('\n'))
    const stats = getStoreStats(root)
    expect(stats.rejections).toBe(2)
  })

  it('counts .md files in decisions/ directory', () => {
    const adrDir = join(root, '.lore', 'decisions')
    mkdirSync(adrDir, { recursive: true })
    writeFileSync(join(adrDir, 'use-jwt.md'), '# ADR: Use JWT\n')
    writeFileSync(join(adrDir, 'add-redis.md'), '# ADR: Add Redis\n')
    writeStore(root, 'decisions', '# Decision Log\n')
    const stats = getStoreStats(root)
    expect(stats.deepADRs).toBe(2)
  })

  it('counts saved session files', () => {
    const sessionsDir = join(root, '.lore', 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    writeFileSync(join(sessionsDir, '2024-01-01T10-00-00.md'), '# Session\n')
    writeFileSync(join(sessionsDir, '2024-01-02T10-00-00.md'), '# Session\n')
    writeStore(root, 'decisions', '# Decision Log\n')
    const stats = getStoreStats(root)
    expect(stats.sessions).toBe(2)
  })

  it('detects evolution.md when present and non-trivial', () => {
    writeStore(root, 'decisions', '# Decision Log\n')
    writeStore(root, 'evolution', '# Evolution\n\n' + 'x'.repeat(200))
    const stats = getStoreStats(root)
    expect(stats.hasEvolution).toBe(true)
  })

  it('reports hasEvolution=false when evolution.md is small', () => {
    writeStore(root, 'decisions', '# Decision Log\n')
    writeStore(root, 'evolution', '# Evolution\n')
    const stats = getStoreStats(root)
    expect(stats.hasEvolution).toBe(false)
  })

  it('counts low-confidence rows', () => {
    writeStore(root, 'decisions', '# Decision Log\n')
    writeStore(root, 'low-confidence', [
      '# Low-Confidence',
      '',
      '| Date | Decision | Affects | Risk |',
      '|------|----------|---------|------|',
      '| 2024-01-01 | Uncertain thing | src/ | low |',
    ].join('\n'))
    const stats = getStoreStats(root)
    expect(stats.lowConfidence).toBe(1)
  })
})
