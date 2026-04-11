import { findLoreRoot, readStore, lorePath, rankDecisions, trimToTokenBudget, buildFileModMap, annotateStaleDecisions, formatStaleWarning } from '@chronicle/core'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'

export async function cmdInject(opts: { files?: string; full?: boolean; format: string; minConfidence?: string; top?: string; tokens?: string; stale?: boolean }) {
  const root = findLoreRoot()
  if (!root) {
    process.stderr.write(chalk.red('✗  No .lore/ found. Run `chronicle init` first.\n'))
    process.exit(1)
  }

  const sections: string[] = []

  // Always include the index
  const index = readStore(root, 'index')
  if (index) sections.push(index)

  // Decisions index — filtered by confidence, ranked by relevance, staleness-annotated
  const decisions = readStore(root, 'decisions')
  if (decisions) {
    const minConf = opts.minConfidence ? parseFloat(opts.minConfidence) : 0.0
    const topN = opts.top ? parseInt(opts.top, 10) : 0
    const fileList = opts.files?.split(',').map(f => f.trim()).filter(Boolean)
    let processed = minConf > 0 ? filterByConfidence(decisions, minConf) : decisions

    // Staleness detection — enabled by default, skip with --no-stale
    if (opts.stale !== false) {
      const modMap = buildFileModMap(root)
      if (modMap.size > 0) {
        const { annotated, stale } = annotateStaleDecisions(processed, modMap)
        processed = annotated
        if (stale.length > 0) sections.push(formatStaleWarning(stale))
      }
    }

    processed = rankDecisions(processed, { files: fileList, topN })
    if (processed) sections.push(processed)
  }

  // Rejected — always included (high signal, compact)
  const rejected = readStore(root, 'rejected')
  if (rejected) sections.push(rejected)

  // Risks — scope to relevant files if --files specified
  const risks = readStore(root, 'risks')
  if (risks) {
    const relevant = opts.files
      ? filterByFiles(risks, opts.files.split(','))
      : risks
    if (relevant) sections.push(relevant)
  }

  // Deep ADRs — only if --full or --files matches their content
  if (opts.full) {
    const deepDir = lorePath(root, 'decisions')
    if (existsSync(deepDir)) {
      for (const file of readdirSync(deepDir).filter(f => f.endsWith('.md'))) {
        sections.push(readFileSync(join(deepDir, file), 'utf8'))
      }
    }
  } else if (opts.files) {
    sections.push(...getRelevantDeepADRs(root, opts.files.split(',')))
  }

  // Evolution — always include a compact version (first era summary only)
  const evolution = readStore(root, 'evolution')
  if (evolution) {
    // Inject only the first era + header to keep token count low
    const compact = evolution.split('---')[0]?.trim()
    if (compact) sections.push(compact)
  }

  // Sessions: rolling history index + most recent raw session
  const sessionsDir = lorePath(root, 'sessions')
  if (existsSync(sessionsDir)) {
    const indexFile = join(sessionsDir, '_index.md')
    const rawSessions = readdirSync(sessionsDir)
      .filter(f => f.endsWith('.md') && f !== '_index.md')
      .sort()
      .reverse()

    // Include compact history index when it exists (covers all sessions in one table)
    if (existsSync(indexFile)) {
      sections.push(readFileSync(indexFile, 'utf8'))
    }

    // Always include the most recent session in full for immediate context
    if (rawSessions[0]) {
      sections.push(`## Last Session\n${readFileSync(join(sessionsDir, rawSessions[0]), 'utf8')}`)
    }
  }

  const maxTokens = opts.tokens ? parseInt(opts.tokens, 10) : 0
  const finalSections = maxTokens > 0 ? trimToTokenBudget(sections, maxTokens) : sections
  const output = formatOutput(finalSections.join('\n\n---\n\n'), opts.format)
  process.stdout.write(output)
}

function filterByConfidence(content: string, minConf: number): string {
  return content
    .split('\n')
    .filter(line => {
      const match = line.match(/<!-- confidence:([\d.]+) -->/)
      if (!match) return true                          // no tag = keep (header rows, high-confidence)
      return parseFloat(match[1]) >= minConf
    })
    .join('\n')
}

function filterByFiles(content: string, files: string[]): string {
  return content
    .split('\n')
    .filter(line => files.some(f => line.includes(f)) || line.startsWith('#') || line.startsWith('|'))
    .join('\n')
}

function getRelevantDeepADRs(root: string, files: string[]): string[] {
  const deepDir = lorePath(root, 'decisions')
  if (!existsSync(deepDir)) return []
  return readdirSync(deepDir)
    .filter(f => f.endsWith('.md'))
    .map(f => readFileSync(join(deepDir, f), 'utf8'))
    .filter(content => files.some(file => content.includes(file)))
}

function formatOutput(content: string, format: string): string {
  switch (format) {
    case 'xml':
      return `<chronicle-context>\n${content}\n</chronicle-context>\n`
    case 'plain':
      return content.replace(/[#*`|]/g, '').replace(/\n{3,}/g, '\n\n')
    default:
      return `<!-- chronicle context -->\n${content}\n<!-- end chronicle context -->\n`
  }
}
