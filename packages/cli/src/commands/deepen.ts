import ora from 'ora'
import chalk from 'chalk'
import {
  findLoreRoot, getCommits, extractFromCommits, createFileCache,
  appendToStore, writeDeepDecision, readStore,
  type ScanDepth
} from '@chronicle/core'
import { makeLLMProvider } from '../llm.js'
import { formatRejectionEntry, formatDeepADR, slugify } from '../format.js'

export async function cmdDeepen(opts: { depth: string; llm?: string; limit?: string; concurrency?: string }) {
  const root = findLoreRoot()
  if (!root) {
    console.error(chalk.red('✗  No .lore/ found. Run `chronicle init` first.'))
    process.exit(1)
  }

  const depth = opts.depth as ScanDepth
  const limit = opts.limit ? parseInt(opts.limit, 10) : undefined
  const llmName = opts.llm ?? 'anthropic'
  const concurrency = opts.concurrency
    ? parseInt(opts.concurrency, 10)
    : llmName === 'ollama' ? 1 : 4

  const spinner = ora(`Scanning deeper: ${depth}...`).start()

  const cache = createFileCache(root)
  const commits = getCommits(root, depth, limit)

  // Only process commits not already in cache
  const uncached = commits.filter(c => !cache.has(c.hash))
  if (uncached.length === 0) {
    spinner.info('No new commits to process at this depth.')
    return
  }

  spinner.text = `Found ${uncached.length} new commits to process...`
  const llm = makeLLMProvider(llmName)

  const results = await extractFromCommits(uncached, llm, { strategy: 'simple', cache, concurrency })

  // Append new results to existing store (don't overwrite)
  const newDecisions = results.filter(r => r.isDecision)
  const newRejections = results.filter(r => r.isRejection)

  for (const r of newRejections) appendToStore(root, 'rejected', formatRejectionEntry(r))
  for (const d of newDecisions.filter(d => d.isDeep)) {
    writeDeepDecision(root, slugify(d.title ?? 'unnamed'), formatDeepADR(d))
  }

  // Prepend new rows to decisions.md (newer = at top)
  const existing = readStore(root, 'decisions')
  const newRows = newDecisions.map(d => {
    const title = d.title ?? 'Unnamed decision'
    const affects = (d.affects ?? []).join(', ')
    return `| ${title.slice(0, 50)} | ${affects.slice(0, 40)} | ${d.risk ?? 'low'} |${d.isDeep ? ` [→](decisions/${slugify(title)}.md)` : ''} |`
  }).join('\n')

  if (newRows) {
    const insertAfter = '|----------|---------|------|-----|\n'
    appendToStore(root, 'decisions', existing.replace(insertAfter, insertAfter + newRows + '\n'))
  }

  spinner.succeed(chalk.green(`Deepened: ${newDecisions.length} decisions, ${newRejections.length} rejections added`))
}
