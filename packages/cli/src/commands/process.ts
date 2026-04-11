/**
 * chronicle process — batch processor for CI/server-side use.
 *
 * Processes all unprocessed commits and updates .lore/ in one pass.
 * Designed for GitHub Actions: runs on push to main, commits updated .lore/.
 *
 * Unlike `chronicle deepen` (interactive, with spinner), this command:
 *   - Outputs structured JSON progress for CI log parsing
 *   - Exits with code 1 on LLM errors (so CI can fail loudly)
 *   - Writes a process-summary to .lore/process.log
 *   - Skips embedding index rebuild (done separately to keep jobs fast)
 *
 * Usage (GitHub Actions):
 *   chronicle process --llm anthropic --depth 1month
 *   chronicle process --from-commit ${{ github.event.before }}
 */

import { execSync } from 'child_process'
import { writeFileSync, existsSync, readFileSync, appendFileSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import {
  findLoreRoot, lorePath,
  getCommits, extractFromCommits, createFileCache,
  appendToStore, writeDeepDecision,
} from '@chronicle/core'
import type { ScanDepth } from '@chronicle/core'

export async function cmdProcess(opts: {
  depth?: string
  llm?: string
  fromCommit?: string
  dryRun?: boolean
}): Promise<void> {
  const root = findLoreRoot()
  if (!root) {
    console.error(chalk.red('✗  .lore/ not found — run `chronicle init` first'))
    process.exit(1)
  }

  const depth = (opts.depth ?? '1month') as ScanDepth
  const cache = createFileCache(root)

  // Collect commits to process
  let commits = getCommits(root, depth)

  // If --from-commit provided, only process commits after that hash
  if (opts.fromCommit) {
    const idx = commits.findIndex(c => c.hash.startsWith(opts.fromCommit!))
    if (idx !== -1) commits = commits.slice(0, idx)
  }

  const uncached = commits.filter(c => !cache.has(c.hash))

  if (uncached.length === 0) {
    console.log(chalk.green('✓  .lore/ is already up-to-date — nothing to process'))
    return
  }

  if (opts.dryRun) {
    console.log(chalk.yellow(`[dry-run] Would process ${uncached.length} commits`))
    for (const c of uncached.slice(0, 10)) {
      console.log(chalk.dim(`  ${c.hash.slice(0, 8)} ${c.date.slice(0, 10)} ${c.subject.slice(0, 60)}`))
    }
    if (uncached.length > 10) console.log(chalk.dim(`  ... and ${uncached.length - 10} more`))
    return
  }

  const { makeLLMProvider } = await import('../llm.js')
  const { formatRejectionEntry, formatDeepADR, slugify } = await import('../format.js')
  const llm = makeLLMProvider(opts.llm ?? process.env.CHRONICLE_LLM ?? 'auto')

  console.log(chalk.cyan(`⟳  Processing ${uncached.length} commits...`))

  const startMs = Date.now()
  let decisionsAdded = 0
  let rejectionsAdded = 0
  let deepAdrsAdded = 0
  let errors = 0

  try {
    const results = await extractFromCommits(uncached, llm, {
      strategy: 'simple',
      cache,
      concurrency: 4,
    })

    // Get author for the processed commits
    let authorEmail = ''
    try {
      authorEmail = execSync('git log -1 --format=%ae HEAD', { cwd: root }).toString().trim()
    } catch { /* non-fatal */ }

    for (const r of results) {
      if (r.isRejection) {
        appendToStore(root, 'rejected', formatRejectionEntry(r))
        rejectionsAdded++
      }
      if (r.isDecision) {
        if (r.isDeep) {
          writeDeepDecision(root, slugify(r.title), formatDeepADR(r))
          deepAdrsAdded++
        }
        const authorComment = authorEmail ? ` <!-- author:${authorEmail} -->` : ''
        const date = r.date ?? new Date().toISOString().slice(0, 10)
        const row = `| ${date} | ${r.title.slice(0, 50)} | ${r.affects.join(', ').slice(0, 40)} | ${r.risk} | <!-- confidence:${r.confidence.toFixed(2)} -->${r.isDeep ? ` [→](decisions/${slugify(r.title)}.md)` : ''}${authorComment}`
        appendToStore(root, 'decisions', row)
        decisionsAdded++
      }
    }
  } catch (err) {
    errors++
    console.error(chalk.red(`✗  Extraction failed: ${err}`))
    process.exit(1)
  }

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1)

  // Write process log
  const logLine = `${new Date().toISOString()} | commits:${uncached.length} decisions:${decisionsAdded} rejections:${rejectionsAdded} deep:${deepAdrsAdded} errors:${errors} elapsed:${elapsedSec}s`
  const logPath = lorePath(root, 'process.log')
  appendFileSync(logPath, logLine + '\n')

  // Summary output
  console.log(chalk.green(`✓  Processed ${uncached.length} commits in ${elapsedSec}s`))
  if (decisionsAdded > 0) console.log(chalk.cyan(`   +${decisionsAdded} decisions`))
  if (rejectionsAdded > 0) console.log(chalk.cyan(`   +${rejectionsAdded} rejections`))
  if (deepAdrsAdded > 0) console.log(chalk.cyan(`   +${deepAdrsAdded} deep ADRs`))
  if (errors > 0) {
    console.error(chalk.red(`   ${errors} errors`))
    process.exit(1)
  }
}
