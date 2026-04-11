/**
 * chronicle merge-driver — git merge driver for decisions.md (M5, v0.8.0)
 *
 * Registered in .git/config as a custom merge driver:
 *   [merge "chronicle-decisions"]
 *     name = Chronicle decisions merge
 *     driver = chronicle merge-driver %O %A %B %P
 *
 * And .gitattributes:
 *   .lore/decisions*.md merge=chronicle-decisions
 *
 * Strategy: union merge — collect all unique table rows from all three versions
 * (base, ours, theirs), deduplicate by title, keep newest date for duplicates.
 * Exits 0 on success (merged), 1 if unresolvable.
 *
 * Args (from git): %O=base %A=ours(modified in place) %B=theirs %P=path
 */

import { readFileSync, writeFileSync } from 'fs'
import chalk from 'chalk'

interface DecisionRow {
  date: string
  raw: string   // full pipe-delimited row
  titleKey: string  // normalized title for dedup
}

export async function cmdMergeDriver(args: { base: string; ours: string; theirs: string; path?: string }) {
  const { base, ours, theirs } = args

  try {
    const baseContent  = readFileSync(base, 'utf8')
    const oursContent  = readFileSync(ours, 'utf8')
    const theirsContent = readFileSync(theirs, 'utf8')

    const merged = mergeDecisionsFiles(baseContent, oursContent, theirsContent)
    writeFileSync(ours, merged, 'utf8')

    // Exit 0 = successful merge
    process.exit(0)
  } catch (err) {
    process.stderr.write(chalk.red(`chronicle merge-driver failed: ${err}\n`))
    process.exit(1)
  }
}

/** Extract the header block (everything before and including the separator row) */
function extractHeader(content: string): string {
  const lines = content.split('\n')
  const sepIdx = lines.findIndex(l => /^\|[-| ]+\|/.test(l))
  return sepIdx >= 0 ? lines.slice(0, sepIdx + 1).join('\n') : ''
}

/** Parse table data rows from decisions.md content */
function parseRows(content: string): DecisionRow[] {
  const rows: DecisionRow[] = []
  let inTable = false
  for (const line of content.split('\n')) {
    if (/^\|[-| ]+\|/.test(line)) { inTable = true; continue }
    if (!inTable || !line.startsWith('|')) continue
    const cols = line.split('|').map(c => c.trim())
    // cols[1]=date cols[2]=title
    const date = cols[1] ?? ''
    const rawTitle = (cols[2] ?? '').replace(/\[.*?\]/g, '').trim()
    const titleKey = rawTitle.toLowerCase().replace(/\s+/g, ' ').slice(0, 50)
    if (titleKey.length < 3) continue
    rows.push({ date, raw: line, titleKey })
  }
  return rows
}

/**
 * Union-merge decisions from three versions.
 * - Keep all rows from ours + theirs that are NOT in base (new decisions from both branches)
 * - Keep all rows from base (existing decisions)
 * - Deduplicate by titleKey: if same title exists in multiple sources, keep newest date
 */
export function mergeDecisionsFiles(base: string, ours: string, theirs: string): string {
  const header = extractHeader(ours) || extractHeader(base) || extractHeader(theirs)

  const baseRows   = parseRows(base)
  const oursRows   = parseRows(ours)
  const theirsRows = parseRows(theirs)

  const baseTitleKeys = new Set(baseRows.map(r => r.titleKey))

  // Collect all rows: base + new from ours + new from theirs
  const allRows = [
    ...baseRows,
    ...oursRows.filter(r => !baseTitleKeys.has(r.titleKey)),
    ...theirsRows.filter(r => !baseTitleKeys.has(r.titleKey)),
  ]

  // Deduplicate: for each titleKey, keep the row with the newest date
  const deduped = new Map<string, DecisionRow>()
  for (const row of allRows) {
    const existing = deduped.get(row.titleKey)
    if (!existing || row.date > existing.date) {
      deduped.set(row.titleKey, row)
    }
  }

  // Sort by date descending (newest first)
  const sorted = [...deduped.values()].sort((a, b) => b.date.localeCompare(a.date))

  return header + '\n' + sorted.map(r => r.raw).join('\n') + '\n'
}

/** Install the merge driver into the repo's .git/config and .gitattributes */
export async function installMergeDriver(repoRoot: string) {
  const { execSync } = await import('child_process')
  const { existsSync, readFileSync, writeFileSync } = await import('fs')
  const { join } = await import('path')

  // Register in git config
  try {
    execSync(
      'git config merge.chronicle-decisions.name "Chronicle decisions merge driver"',
      { cwd: repoRoot }
    )
    execSync(
      'git config merge.chronicle-decisions.driver "chronicle merge-driver %O %A %B %P"',
      { cwd: repoRoot }
    )
  } catch {
    process.stderr.write(chalk.yellow('⚠  Could not configure git merge driver\n'))
    return
  }

  // Add .gitattributes entry
  const attrFile = join(repoRoot, '.gitattributes')
  const attrLine = '.lore/decisions*.md merge=chronicle-decisions\n'
  const existing = existsSync(attrFile) ? readFileSync(attrFile, 'utf8') : ''
  if (!existing.includes('chronicle-decisions')) {
    writeFileSync(attrFile, existing + attrLine, 'utf8')
  }
}
