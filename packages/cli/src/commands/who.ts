import chalk from 'chalk'
import { findLoreRoot, readStore, loadOwnership, getOwnersForFile, parseAuthorFromRow, extractTitleFromRow } from '@chronicle/core'

export async function cmdWho(filePath: string) {
  const root = findLoreRoot()
  if (!root) {
    console.error(chalk.red('✗  No .lore/ found. Run `chronicle init` first.'))
    process.exit(1)
  }

  const { relative } = await import('path')
  const rel = filePath.startsWith('/') ? relative(root, filePath) : filePath

  // ── Ownership ────────────────────────────────────────────────────────────
  const ownershipMap = loadOwnership(root)
  const owners = getOwnersForFile(rel, ownershipMap)

  console.log(chalk.bold(`\nFile: ${rel}\n`))

  if (owners.length > 0) {
    console.log(chalk.cyan('Owner(s):'))
    for (const o of owners) console.log(`  ${o}`)
    if (ownershipMap.source !== 'none') {
      console.log(chalk.dim(`  (source: ${ownershipMap.source})\n`))
    }
  } else {
    console.log(chalk.dim('  No ownership defined for this file.\n'))
    if (ownershipMap.source === 'none') {
      console.log(chalk.dim('  Add a CODEOWNERS file or run `chronicle who --add-owner` to define one.\n'))
    }
  }

  // ── Decisions affecting this file ────────────────────────────────────────
  const decisions = readStore(root, 'decisions')
  const relevantRows = decisions
    .split('\n')
    .filter(line => line.startsWith('|') && line.includes(rel.split('/')[0]))

  if (relevantRows.length > 0) {
    console.log(chalk.cyan('Decisions touching this file:'))
    for (const row of relevantRows) {
      const title = extractTitleFromRow(row)
      const author = parseAuthorFromRow(row)
      const dateMatch = row.match(/\|\s*(\d{4}-\d{2}-\d{2})\s*\|/)
      const date = dateMatch?.[1] ?? ''
      const authorStr = author ? chalk.dim(` by ${author}`) : ''
      console.log(`  ${chalk.dim(date)} ${title ?? '(unknown)'}${authorStr}`)
    }
  } else {
    console.log(chalk.dim('  No recorded decisions affecting this file.'))
  }

  // ── Risks affecting this file ─────────────────────────────────────────────
  const risks = readStore(root, 'risks')
  const relevantRisks = risks
    .split('\n')
    .filter(line => line.includes(rel) || line.includes(rel.split('/')[0]))
    .filter(l => l.trim().length > 0)
    .slice(0, 5)

  if (relevantRisks.length > 0) {
    console.log(chalk.yellow('\nRisks:'))
    for (const r of relevantRisks) console.log(`  ${r.trim()}`)
  }

  console.log()
}
