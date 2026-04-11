/**
 * chronicle verify — CI freshness gate.
 *
 * Checks whether .lore/ is up-to-date with recent commits.
 * Exits 0 if fresh, exits 1 if stale (for CI pipeline enforcement).
 *
 * Used in GitHub Actions to gate PRs/merges when .lore/ hasn't been updated.
 * Also useful pre-commit to remind developers to run `chronicle deepen`.
 *
 * Usage:
 *   chronicle verify                  # fails if >5 unprocessed commits
 *   chronicle verify --max-lag 20     # custom threshold
 *   chronicle verify --json           # machine-readable output
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { findLoreRoot, lorePath } from '@chronicle/core'

export interface VerifyResult {
  fresh: boolean
  unprocessedCommits: number
  lastUpdated: string | null
  loreExists: boolean
  message: string
}

export async function cmdVerify(opts: {
  maxLag?: string
  json?: boolean
  quiet?: boolean
}): Promise<void> {
  const maxLag = parseInt(opts.maxLag ?? '5', 10)
  const root = findLoreRoot()

  if (!root) {
    const result: VerifyResult = {
      fresh: false,
      unprocessedCommits: 0,
      lastUpdated: null,
      loreExists: false,
      message: '.lore/ not found — run `chronicle init` first',
    }
    outputResult(result, opts)
    process.exit(1)
  }

  // Count commits since last .lore/ update
  const loreDirPath = lorePath(root)
  const decisionsPath = join(loreDirPath, 'decisions.md')

  if (!existsSync(decisionsPath)) {
    const result: VerifyResult = {
      fresh: false,
      unprocessedCommits: 0,
      lastUpdated: null,
      loreExists: false,
      message: 'decisions.md not found — run `chronicle init` first',
    }
    outputResult(result, opts)
    process.exit(1)
  }

  // Find how many commits have happened since the last cache update
  const cacheFile = join(loreDirPath, '.extraction-cache.json')
  const cachedHashes = loadCachedHashes(cacheFile)

  let recentCommits: string[] = []
  try {
    const raw = execSync(
      `git -C "${root}" log --since="3 months ago" --no-merges --format="%H" | head -200`,
      { maxBuffer: 1024 * 1024 }
    ).toString().trim()
    recentCommits = raw.split('\n').filter(Boolean)
  } catch {
    // Not a git repo or git unavailable — skip
  }

  const unprocessed = recentCommits.filter(h => !cachedHashes.has(h))
  const lastUpdated = getLastLoreUpdate(root, loreDirPath)
  const fresh = unprocessed.length <= maxLag

  const result: VerifyResult = {
    fresh,
    unprocessedCommits: unprocessed.length,
    lastUpdated,
    loreExists: true,
    message: fresh
      ? `.lore/ is up-to-date (${unprocessed.length} unprocessed commits ≤ threshold ${maxLag})`
      : `.lore/ is stale: ${unprocessed.length} unprocessed commits (threshold: ${maxLag}) — run \`chronicle deepen\``,
  }

  outputResult(result, opts)
  if (!fresh) process.exit(1)
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function loadCachedHashes(cacheFile: string): Set<string> {
  if (!existsSync(cacheFile)) return new Set()
  try {
    const data = JSON.parse(readFileSync(cacheFile, 'utf8'))
    return new Set(Object.keys(data))
  } catch {
    return new Set()
  }
}

function getLastLoreUpdate(root: string, loreDirPath: string): string | null {
  try {
    // Use git log on .lore/ directory to find last commit touching it
    const raw = execSync(
      `git -C "${root}" log -1 --format="%ai" -- "${loreDirPath}"`,
      { maxBuffer: 64 * 1024 }
    ).toString().trim()
    return raw || null
  } catch {
    return null
  }
}

function outputResult(result: VerifyResult, opts: { json?: boolean; quiet?: boolean }) {
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (opts.quiet) {
    if (!result.fresh) console.error(result.message)
    return
  }

  if (result.fresh) {
    console.log(chalk.green('✓ ' + result.message))
    if (result.lastUpdated) {
      console.log(chalk.dim(`  Last .lore/ update: ${result.lastUpdated}`))
    }
  } else {
    console.error(chalk.red('✗ ' + result.message))
    if (result.lastUpdated) {
      console.error(chalk.dim(`  Last .lore/ update: ${result.lastUpdated}`))
    }
    console.error(chalk.yellow('  Run: chronicle deepen --depth 1month'))
    console.error(chalk.yellow('  Or:  chronicle process  (in CI)'))
  }
}
