import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import os from 'os'
import {
  findLoreRoot, initStore, readStore, writeStore, appendToStore,
  writeDeepDecision, listSessions, lorePath, LORE_DIR
} from '../store.js'

function makeTempDir(): string {
  const dir = join(os.tmpdir(), `chronicle-test-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('store', () => {
  let root: string

  beforeEach(() => { root = makeTempDir() })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  describe('initStore', () => {
    it('creates .lore/ with required subdirectories', () => {
      initStore(root)
      expect(existsSync(lorePath(root))).toBe(true)
      expect(existsSync(lorePath(root, 'decisions'))).toBe(true)
      expect(existsSync(lorePath(root, 'diagrams'))).toBe(true)
      expect(existsSync(lorePath(root, 'sessions'))).toBe(true)
    })

    it('is idempotent — safe to call twice', () => {
      initStore(root)
      expect(() => initStore(root)).not.toThrow()
    })
  })

  describe('findLoreRoot', () => {
    it('returns root when .lore/ exists at cwd', () => {
      initStore(root)
      expect(findLoreRoot(root)).toBe(root)
    })

    it('finds root from a subdirectory', () => {
      initStore(root)
      const sub = join(root, 'src', 'deep', 'nested')
      mkdirSync(sub, { recursive: true })
      expect(findLoreRoot(sub)).toBe(root)
    })

    it('returns null when no .lore/ exists', () => {
      expect(findLoreRoot(root)).toBeNull()
    })
  })

  describe('readStore / writeStore', () => {
    beforeEach(() => initStore(root))

    it('returns empty string for missing file', () => {
      expect(readStore(root, 'decisions')).toBe('')
    })

    it('writes and reads back content', () => {
      writeStore(root, 'decisions', '# Decision Log\n')
      expect(readStore(root, 'decisions')).toBe('# Decision Log\n')
    })

    it('overwrites existing content', () => {
      writeStore(root, 'decisions', 'first')
      writeStore(root, 'decisions', 'second')
      expect(readStore(root, 'decisions')).toBe('second')
    })
  })

  describe('appendToStore', () => {
    beforeEach(() => initStore(root))

    it('creates file if it does not exist', () => {
      appendToStore(root, 'rejected', '## Rejection A')
      expect(readStore(root, 'rejected')).toContain('Rejection A')
    })

    it('appends without losing existing content', () => {
      appendToStore(root, 'rejected', '## Rejection A')
      appendToStore(root, 'rejected', '## Rejection B')
      const content = readStore(root, 'rejected')
      expect(content).toContain('Rejection A')
      expect(content).toContain('Rejection B')
    })
  })

  describe('writeDeepDecision', () => {
    beforeEach(() => initStore(root))

    it('writes to decisions/<slug>.md', () => {
      writeDeepDecision(root, 'jwt-auth', '# ADR: JWT Auth\n')
      const path = lorePath(root, 'decisions', 'jwt-auth.md')
      expect(existsSync(path)).toBe(true)
    })

    it('returns the file path', () => {
      const path = writeDeepDecision(root, 'my-decision', 'content')
      expect(path).toContain('my-decision.md')
    })
  })

  describe('listSessions', () => {
    beforeEach(() => initStore(root))

    it('returns empty array when no sessions exist', () => {
      expect(listSessions(root)).toEqual([])
    })

    it('returns sessions sorted newest-first', () => {
      const { writeFileSync } = require('fs')
      writeFileSync(lorePath(root, 'sessions', '2025-01-01.md'), '')
      writeFileSync(lorePath(root, 'sessions', '2025-03-01.md'), '')
      writeFileSync(lorePath(root, 'sessions', '2025-02-01.md'), '')
      const sessions = listSessions(root)
      expect(sessions[0]).toBe('2025-03-01.md')
      expect(sessions[2]).toBe('2025-01-01.md')
    })
  })
})
