/**
 * chronicle status — single-line health summary.
 *
 * Combines store stats (decisions, ADRs, sessions) with the unprocessed-commit
 * count from `chronicle verify` to give a quick at-a-glance view.
 *
 * Usage:
 *   chronicle status           # compact one-liner
 *   chronicle status --json    # machine-readable
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { findLoreRoot, lorePath } from '@chronicle/core'
import { getStoreStats } from '../status.js'

export async function cmdStatus(opts: { json?: boolean }): Promise<void> {
  const root = findLoreRoot()

  if (!root) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, message: '.lore/ not found' }))
    } else {
      console.error(chalk.red('✗  .lore/ not found — run `chronicle init` first'))
    }
    process.exit(1)
  }

  const stats = getStoreStats(root)
  const unprocessed = countUnprocessed(root)
  const fresh = unprocessed <= 5

  if (opts.json) {
    console.log(JSON.stringify({
      ok: fresh,
      decisions: stats.decisions,
      rejections: stats.rejections,
      deepADRs: stats.deepADRs,
      sessions: stats.sessions,
      unprocessedCommits: unprocessed,
      lastCapture: stats.lastCapture,
      hasEvolution: stats.hasEvolution,
      lowConfidence: stats.lowConfidence,
      extractionErrors: stats.extractionErrors,
    }, null, 2))
    return
  }

  const freshnessIcon = fresh ? chalk.green('✓') : chalk.yellow('⚠')
  const lagLabel = fresh
    ? chalk.dim(`${unprocessed} unprocessed`)
    : chalk.yellow(`${unprocessed} unprocessed — run \`chronicle deepen\``)

  const parts = [
    chalk.cyan('◆ chronicle'),
    chalk.dim('│'),
    chalk.white(`${stats.decisions} decisions`),
    chalk.dim('·'),
    chalk.red(`${stats.rejections} rejected`),
    chalk.dim('·'),
    chalk.yellow(`${stats.deepADRs} ADRs`),
    chalk.dim('·'),
    chalk.green(`${stats.sessions} sessions`),
    chalk.dim('│'),
    `${freshnessIcon} ${lagLabel}`,
  ]
  if (stats.lowConfidence > 0) {
    parts.push(chalk.dim('·'), chalk.dim(`${stats.lowConfidence} low-confidence`))
  }
  if (stats.extractionErrors > 0) {
    parts.push(chalk.dim('·'), chalk.red(`⚠ ${stats.extractionErrors} extraction errors`))
  }
  console.log(parts.join(' '))
}

// ── helpers ────────────────────────────────────────────────────────────────────

function countUnprocessed(root: string): number {
  const cacheFile = join(lorePath(root), '.extraction-cache.json')
  const cached = loadCachedHashes(cacheFile)
  try {
    const raw = execSync(
      `git -C "${root}" log --since="3 months ago" --no-merges --format="%H" | head -200`,
      { maxBuffer: 1024 * 1024 }
    ).toString().trim()
    const hashes = raw.split('\n').filter(Boolean)
    return hashes.filter(h => !cached.has(h)).length
  } catch {
    return 0
  }
}

function loadCachedHashes(cacheFile: string): Set<string> {
  if (!existsSync(cacheFile)) return new Set()
  try {
    return new Set(Object.keys(JSON.parse(readFileSync(cacheFile, 'utf8'))))
  } catch {
    return new Set()
  }
}
