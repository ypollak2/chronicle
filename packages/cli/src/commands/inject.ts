import { findLoreRoot, readStore, lorePath } from '@chronicle/core'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'

export async function cmdInject(opts: { files?: string; full?: boolean; format: string }) {
  const root = findLoreRoot()
  if (!root) {
    process.stderr.write(chalk.red('✗  No .lore/ found. Run `chronicle init` first.\n'))
    process.exit(1)
  }

  const sections: string[] = []

  // Always include the index
  const index = readStore(root, 'index')
  if (index) sections.push(index)

  // Decisions index (lightweight — just the table)
  const decisions = readStore(root, 'decisions')
  if (decisions) sections.push(decisions)

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

  // Most recent session
  const sessionsDir = lorePath(root, 'sessions')
  if (existsSync(sessionsDir)) {
    const sessions = readdirSync(sessionsDir).filter(f => f.endsWith('.md')).sort().reverse()
    if (sessions[0]) {
      sections.push(`## Last Session\n${readFileSync(join(sessionsDir, sessions[0]), 'utf8')}`)
    }
  }

  const output = formatOutput(sections.join('\n\n---\n\n'), opts.format)
  process.stdout.write(output)
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
