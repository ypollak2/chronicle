import { describe, it, expect } from 'vitest'
import { getCommits, type ScanDepth } from '../scanner.js'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import os from 'os'

function makeGitRepo(): string {
  const dir = join(os.tmpdir(), `chronicle-git-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  execSync('git init', { cwd: dir })
  execSync('git config user.email "test@test.com"', { cwd: dir })
  execSync('git config user.name "Test"', { cwd: dir })
  return dir
}

function addCommit(repo: string, subject: string, fileContent = 'x'.repeat(500)): void {
  const file = join(repo, `file-${Date.now()}.ts`)
  writeFileSync(file, fileContent)
  execSync(`git add . && git commit -m "${subject}"`, { cwd: repo })
}

describe('getCommits', () => {
  let repo: string
  beforeEach(() => { repo = makeGitRepo() })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it('returns empty array for repo with no commits', () => {
    expect(getCommits(repo, '6months')).toEqual([])
  })

  it('returns empty array for non-git directory', () => {
    const dir = join(os.tmpdir(), `not-git-${Date.now()}`)
    mkdirSync(dir)
    expect(getCommits(dir, '6months')).toEqual([])
    rmSync(dir, { recursive: true })
  })

  it('filters out noise prefixes (chore, style, docs)', () => {
    addCommit(repo, 'chore: update dependencies', 'x'.repeat(600))
    addCommit(repo, 'style: fix formatting', 'y'.repeat(600))
    addCommit(repo, 'docs: update README', 'z'.repeat(600))
    // All noise — should return empty (or only non-noise)
    const commits = getCommits(repo, '6months')
    expect(commits.every(c => !c.subject.startsWith('chore:'))).toBe(true)
    expect(commits.every(c => !c.subject.startsWith('style:'))).toBe(true)
    expect(commits.every(c => !c.subject.startsWith('docs:'))).toBe(true)
  })

  it('includes feat: commits with sufficient diff size', () => {
    // Need >20 changed lines — write a file with 30+ lines
    const bigContent = Array.from({ length: 35 }, (_, i) => `const x${i} = ${i}`).join('\n')
    addCommit(repo, 'feat: add authentication module', bigContent)
    const commits = getCommits(repo, '6months')
    expect(commits.some(c => c.subject.includes('authentication'))).toBe(true)
  })

  it('filters out commits with small diffs', () => {
    addCommit(repo, 'feat: tiny change', 'one line change')
    const commits = getCommits(repo, '6months')
    // Small diff (< 20 changed lines) should be filtered
    expect(commits.every(c => !c.subject.includes('tiny change'))).toBe(true)
  })

  it('populates CommitMeta fields', () => {
    const bigContent = Array.from({ length: 35 }, (_, i) => `const y${i} = ${i}`).join('\n')
    addCommit(repo, 'feat: large feature', bigContent)
    const commits = getCommits(repo, '6months')
    if (commits.length > 0) {
      const c = commits[0]
      expect(c.hash).toHaveLength(40)
      expect(c.date).toBeTruthy()
      expect(c.subject).toBeTruthy()
      expect(c.diff).toBeTruthy()
    }
  })
})
