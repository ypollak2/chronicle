/**
 * chronicle decision — manage decision lifecycle and promote low-confidence entries
 *
 * Usage:
 *   chronicle decision deprecate "<title-substring>"     # mark as deprecated
 *   chronicle decision supersede "<title>" --by "<new>"  # mark superseded
 *   chronicle decision promote "<title-substring>"       # promote from low-confidence.md
 *   chronicle decision list                              # show all with status
 */

import chalk from 'chalk'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { findLoreRoot, lorePath } from '@chronicle/core'

type LifecycleStatus = 'deprecated' | 'superseded' | 'active'

interface DecisionOpts {
  subcommand?: string
  title?: string
  by?: string    // for supersede: the decision that replaced it
  status?: string
}

export async function cmdDecision(opts: DecisionOpts) {
  const root = findLoreRoot()
  if (!root) {
    process.stderr.write(chalk.red('✗  No .lore/ found. Run `chronicle init` first.\n'))
    process.exit(1)
  }

  const sub = opts.subcommand
  if (!sub) {
    printHelp()
    return
  }

  switch (sub) {
    case 'deprecate':
      await setStatus(root, opts.title ?? '', 'deprecated', undefined)
      break
    case 'supersede':
      if (!opts.by) {
        process.stderr.write(chalk.red('✗  --by <replacement> is required for supersede\n'))
        process.exit(1)
      }
      await setStatus(root, opts.title ?? '', 'superseded', opts.by)
      break
    case 'promote':
      await promoteDecision(root, opts.title ?? '')
      break
    case 'list':
      await listDecisions(root)
      break
    default:
      process.stderr.write(chalk.red(`✗  Unknown subcommand: ${sub}\n`))
      printHelp()
      process.exit(1)
  }
}

/** Mark a decision row in decisions.md with a lifecycle status comment. */
async function setStatus(root: string, titleQuery: string, status: LifecycleStatus, replacedBy: string | undefined) {
  if (!titleQuery) {
    process.stderr.write(chalk.red('✗  Provide a title substring to match\n'))
    process.exit(1)
  }

  const decisionsPath = lorePath(root, 'decisions.md')
  if (!existsSync(decisionsPath)) {
    process.stderr.write(chalk.red('✗  decisions.md not found\n'))
    process.exit(1)
  }

  const original = readFileSync(decisionsPath, 'utf8')
  const query = titleQuery.toLowerCase()
  let matched = 0

  const updated = original
    .split('\n')
    .map(line => {
      // Only touch data rows (starting with |)
      if (!line.startsWith('|') || line.startsWith('| Date') || line.startsWith('|---')) return line
      if (!line.toLowerCase().includes(query)) return line

      matched++
      // Remove any existing status tag before adding the new one
      const cleaned = line.replace(/\s*<!--status:[^>]+-->/g, '')
      const tag = replacedBy
        ? `<!--status:${status} by:${replacedBy.slice(0, 60)}-->`
        : `<!--status:${status}-->`
      return cleaned.trimEnd() + ' ' + tag
    })
    .join('\n')

  if (matched === 0) {
    console.log(chalk.yellow(`⚠  No decision matching "${titleQuery}" found in decisions.md`))
    return
  }

  writeFileSync(decisionsPath, updated)

  const verb = status === 'deprecated' ? 'Deprecated' : `Marked as superseded`
  const suffix = replacedBy ? ` (by: ${replacedBy})` : ''
  console.log(chalk.green(`✓  ${verb} ${matched} decision(s) matching "${titleQuery}"${suffix}`))
  if (status === 'deprecated') {
    console.log(chalk.dim('  chronicle inject will omit deprecated decisions from context by default'))
  }
}

/** Promote a decision from low-confidence.md to decisions.md */
async function promoteDecision(root: string, titleQuery: string) {
  if (!titleQuery) {
    process.stderr.write(chalk.red('✗  Provide a title substring to match\n'))
    process.exit(1)
  }

  const lowPath = lorePath(root, 'low-confidence.md')
  const decisionsPath = lorePath(root, 'decisions.md')

  if (!existsSync(lowPath)) {
    process.stderr.write(chalk.red('✗  low-confidence.md not found\n'))
    process.exit(1)
  }

  const lowContent = readFileSync(lowPath, 'utf8')
  const query = titleQuery.toLowerCase()
  const matched: string[] = []
  const remaining: string[] = []

  for (const line of lowContent.split('\n')) {
    if (line.startsWith('|') && !line.startsWith('| Date') && !line.startsWith('|---') &&
        line.toLowerCase().includes(query)) {
      // Remove low-confidence comment tag on promotion
      const cleaned = line.replace(/\s*<!--\s*confidence:[^>]+-->/g, '').trimEnd()
      matched.push(cleaned)
    } else {
      remaining.push(line)
    }
  }

  if (matched.length === 0) {
    console.log(chalk.yellow(`⚠  No entry matching "${titleQuery}" found in low-confidence.md`))
    return
  }

  // Append promoted rows to decisions.md
  const decisionsContent = existsSync(decisionsPath)
    ? readFileSync(decisionsPath, 'utf8')
    : '# Decision Log\n\n| Date | Decision | Affects | Risk | ADR |\n|------|----------|---------|------|-----|\n'

  const promoted = matched.map(r => r + ' <!--status:promoted-->').join('\n')
  writeFileSync(decisionsPath, decisionsContent.trimEnd() + '\n' + promoted + '\n')
  writeFileSync(lowPath, remaining.join('\n'))

  console.log(chalk.green(`✓  Promoted ${matched.length} decision(s) from low-confidence.md to decisions.md`))
}

/** List all decisions with their lifecycle status */
async function listDecisions(root: string) {
  const decisionsPath = lorePath(root, 'decisions.md')
  if (!existsSync(decisionsPath)) {
    console.log(chalk.yellow('No decisions.md found'))
    return
  }

  const content = readFileSync(decisionsPath, 'utf8')
  const rows = content.split('\n').filter(l =>
    l.startsWith('|') && !l.startsWith('| Date') && !l.startsWith('|---')
  )

  if (rows.length === 0) {
    console.log(chalk.dim('No decisions recorded yet.'))
    return
  }

  console.log(chalk.bold('\n◆ Decisions\n'))
  for (const row of rows) {
    const status = extractStatus(row)
    const title = extractColumn(row, 1)
    const date = extractColumn(row, 0)
    const risk = extractColumn(row, 3)

    const statusBadge = status === 'deprecated' ? chalk.red('[deprecated]')
      : status === 'superseded' ? chalk.yellow('[superseded]')
      : status === 'promoted' ? chalk.cyan('[promoted]')
      : chalk.green('[active]')

    console.log(`  ${statusBadge} ${chalk.bold(title)} ${chalk.dim(`${date} · ${risk} risk`)}`)
  }
  console.log()
}

function extractStatus(row: string): string {
  const match = row.match(/<!--status:([^->]+)/)
  return match ? match[1].trim().split(' ')[0] : 'active'
}

function extractColumn(row: string, index: number): string {
  const cols = row.split('|').filter(Boolean)
  return (cols[index] ?? '').trim().replace(/<!--[^>]+-->/g, '').trim()
}

function printHelp() {
  console.log(`
${chalk.bold('chronicle decision')} — manage architectural decision lifecycle

${chalk.bold('Subcommands:')}
  ${chalk.cyan('deprecate')} "<title>"            Mark a decision as deprecated
  ${chalk.cyan('supersede')} "<title>" --by <new> Mark a decision as superseded by another
  ${chalk.cyan('promote')}   "<title>"            Promote from low-confidence.md to decisions.md
  ${chalk.cyan('list')}                           Show all decisions with lifecycle status

${chalk.bold('Examples:')}
  chronicle decision deprecate "Use Redis for sessions"
  chronicle decision supersede "Webpack" --by "Vite"
  chronicle decision promote "TypeScript strict mode"
  chronicle decision list
`)
}
