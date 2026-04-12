/**
 * Chronicle terminal status — shown before and after every command.
 * Gives users a persistent sense of what Chronicle knows and when it last updated.
 */
import { readStore, findLoreRoot, listSessions, lorePath } from '@chronicle/core'
import { existsSync, statSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'

const ICON = '◆'  // Chronicle's identity marker

export interface StoreStats {
  decisions: number
  rejections: number
  deepADRs: number
  sessions: number
  lastCapture: string | null
  hasEvolution: boolean
  hasDiagrams: boolean
  lowConfidence: number
  extractionErrors: number
}

export function getStoreStats(root: string): StoreStats {
  const decisions = countTableRows(readStore(root, 'decisions'))
  const rejections = countHeadings(readStore(root, 'rejected'))
  const deepADRs  = countFiles(lorePath(root, 'decisions'), '.md')
  const sessions  = listSessions(root).length
  const lastCapture = getLastModified(lorePath(root, 'decisions.md'))
  const hasEvolution = existsSync(lorePath(root, 'evolution.md')) &&
    readStore(root, 'evolution').length > 100
  const hasDiagrams = countFiles(lorePath(root, 'diagrams'), '.txt') > 0
  const lowConfidence = countTableRows(readStore(root, 'low-confidence'))
  const extractionErrors = getLastProcessErrors(root)

  return { decisions, rejections, deepADRs, sessions, lastCapture, hasEvolution, hasDiagrams, lowConfidence, extractionErrors }
}

// Print a compact one-line status before a command runs
export function printStatusBefore(root: string, command: string): void {
  const stats = getStoreStats(root)
  const age = stats.lastCapture ? relativeTime(stats.lastCapture) : 'never'
  const parts = [
    chalk.cyan(`${ICON} chronicle`),
    chalk.dim('│'),
    chalk.white(`${stats.decisions} decisions`),
    chalk.dim('·'),
    chalk.red(`${stats.rejections} rejected`),
    chalk.dim('·'),
    chalk.yellow(`${stats.deepADRs} ADRs`),
    chalk.dim('·'),
    chalk.dim(`last capture: ${age}`),
  ]
  process.stderr.write(parts.join(' ') + '\n')
}

// Print a summary after a command completes showing what changed
export function printStatusAfter(root: string, beforeStats: StoreStats): void {
  const after = getStoreStats(root)

  const newDecisions  = after.decisions  - beforeStats.decisions
  const newRejections = after.rejections - beforeStats.rejections
  const newADRs       = after.deepADRs  - beforeStats.deepADRs
  const newSessions   = after.sessions  - beforeStats.sessions

  const changes: string[] = []
  if (newDecisions  > 0) changes.push(chalk.white(`+${newDecisions} decision${newDecisions > 1 ? 's' : ''}`))
  if (newRejections > 0) changes.push(chalk.red(`+${newRejections} rejection${newRejections > 1 ? 's' : ''}`))
  if (newADRs       > 0) changes.push(chalk.yellow(`+${newADRs} ADR${newADRs > 1 ? 's' : ''}`))
  if (newSessions   > 0) changes.push(chalk.green(`+${newSessions} session${newSessions > 1 ? 's' : ''}`))

  if (changes.length === 0) return  // nothing changed, stay quiet

  process.stderr.write(
    chalk.cyan(`${ICON}`) + chalk.dim(' chronicle wrote ') +
    changes.join(chalk.dim(', ')) + '\n'
  )
}

// ── helpers ───────────────────────────────────────────────────────────────────

function countTableRows(content: string): number {
  return content.split('\n').filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('Decision') && !l.includes('Affects')).length
}

function getLastProcessErrors(root: string): number {
  const logPath = lorePath(root, 'process.log')
  if (!existsSync(logPath)) return 0
  try {
    const lines = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean)
    const last = lines[lines.length - 1]
    if (!last) return 0
    const m = last.match(/errors:(\d+)/)
    return m ? parseInt(m[1], 10) : 0
  } catch { return 0 }
}

function countHeadings(content: string): number {
  return (content.match(/^## /gm) ?? []).length
}

function countFiles(dir: string, ext: string): number {
  if (!existsSync(dir)) return 0
  try { return readdirSync(dir).filter(f => f.endsWith(ext)).length } catch { return 0 }
}

function getLastModified(path: string): string | null {
  if (!existsSync(path)) return null
  try { return statSync(path).mtime.toISOString() } catch { return null }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins < 2)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}
