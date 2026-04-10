import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { initStore, writeStore } from '@chronicle/core'
import { installAdapter, ALL_TOOLS } from '../adapters/index.js'

function makeTempRepo(): string {
  const dir = join(os.tmpdir(), `chronicle-adapter-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  initStore(dir)
  writeStore(dir, 'decisions', '# Decision Log\n\n| Decision | Affects | Risk | ADR |\n|----------|---------|------|-----|\n| Use JWT | auth/ | high | |\n')
  writeStore(dir, 'rejected', '## Prisma — rejected\nType conflicts\n')
  return dir
}

describe('adapters', () => {
  let root: string
  beforeEach(() => { root = makeTempRepo() })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  describe('claude-code', () => {
    it('creates .claude/mcp.json with chronicle server', () => {
      installAdapter(root, 'claude-code')
      const mcp = JSON.parse(readFileSync(join(root, '.claude', 'mcp.json'), 'utf8'))
      expect(mcp.servers.chronicle).toBeDefined()
      expect(mcp.servers.chronicle.command).toBe('chronicle')
    })

    it('creates .claude/settings.json with hooks', () => {
      installAdapter(root, 'claude-code')
      const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'))
      expect(settings.hooks.SessionStart).toContain('chronicle inject')
      expect(settings.hooks.Stop).toContain('chronicle capture')
    })

    it('merges with existing settings.json without overwriting other keys', () => {
      mkdirSync(join(root, '.claude'), { recursive: true })
      writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({ theme: 'dark' }))
      installAdapter(root, 'claude-code')
      const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'))
      expect(settings.theme).toBe('dark')
      expect(settings.hooks).toBeDefined()
    })
  })

  describe('aider', () => {
    it('creates .aider.conf.yml with .lore/ read entries', () => {
      installAdapter(root, 'aider')
      const conf = readFileSync(join(root, '.aider.conf.yml'), 'utf8')
      expect(conf).toContain('.lore/index.md')
      expect(conf).toContain('.lore/decisions.md')
      expect(conf).toContain('.lore/rejected.md')
    })

    it('does not duplicate entries on repeated installs', () => {
      installAdapter(root, 'aider')
      installAdapter(root, 'aider')
      const conf = readFileSync(join(root, '.aider.conf.yml'), 'utf8')
      const count = (conf.match(/chronicle-managed/g) ?? []).length
      expect(count).toBe(1)
    })
  })

  describe('gemini-cli', () => {
    it('creates GEMINI.md', () => {
      installAdapter(root, 'gemini-cli')
      expect(existsSync(join(root, 'GEMINI.md'))).toBe(true)
      const content = readFileSync(join(root, 'GEMINI.md'), 'utf8')
      expect(content).toContain('Chronicle')
    })
  })

  describe('copilot', () => {
    it('creates .github/copilot-instructions.md', () => {
      installAdapter(root, 'copilot')
      expect(existsSync(join(root, '.github', 'copilot-instructions.md'))).toBe(true)
    })
  })

  describe('opencode', () => {
    it('creates .opencode.json with contextFiles', () => {
      installAdapter(root, 'opencode')
      const conf = JSON.parse(readFileSync(join(root, '.opencode.json'), 'utf8'))
      expect(conf.contextFiles).toContain('.lore/index.md')
    })
  })

  describe('generic pipe tools', () => {
    it.each(['trae', 'factory'] as const)('%s returns pipe instructions', (tool) => {
      const result = installAdapter(root, tool)
      expect(result.instructions).toContain('chronicle inject')
      expect(result.filesWritten).toHaveLength(0)
    })
  })

  it('ALL_TOOLS covers all expected integrations', () => {
    const expected = ['claude-code', 'cursor', 'aider', 'gemini-cli', 'copilot', 'codex', 'opencode', 'trae', 'factory', 'openclaw']
    for (const t of expected) expect(ALL_TOOLS).toContain(t)
  })
})
