import chalk from 'chalk'
import { execSync } from 'child_process'
import { findLoreRoot, readContext, writeContext, addContextFact, removeContextFact, formatContextForInject } from '@chronicle/core'
import type { BusinessContext } from '@chronicle/core'

type ContextKey = keyof BusinessContext

export async function cmdContext(opts: {
  action: 'add' | 'show' | 'edit' | 'remove'
  goal?: string
  constraint?: string
  team?: string
  stack?: string
  nonGoal?: string
  fact?: string
}) {
  const root = findLoreRoot()
  if (!root) {
    console.error(chalk.red('✗  No .lore/ found. Run `chronicle init` first.'))
    process.exit(1)
  }

  if (opts.action === 'show') {
    const ctx = readContext(root)
    const formatted = formatContextForInject(ctx)
    if (!formatted) {
      console.log(chalk.dim('  No project context defined yet.'))
      console.log(chalk.dim('  Use `chronicle context add --goal "..."` to start.'))
    } else {
      console.log(formatted)
    }
    return
  }

  if (opts.action === 'edit') {
    const { lorePath } = await import('@chronicle/core')
    const { existsSync } = await import('fs')
    const ctxPath = lorePath(root, 'context.md')
    if (!existsSync(ctxPath)) {
      // Bootstrap an empty context first
      writeContext(root, { goals: [], constraints: [], team: [], stack: [], nonGoals: [] })
    }
    const editor = process.env.EDITOR ?? process.env.VISUAL ?? 'vi'
    try {
      execSync(`${editor} "${ctxPath}"`, { stdio: 'inherit' })
      console.log(chalk.green('✓  context.md saved'))
    } catch {
      console.error(chalk.red(`✗  Could not open editor "${editor}". Set $EDITOR env var.`))
    }
    return
  }

  // add / remove
  const pairs: Array<[ContextKey, string]> = []
  if (opts.goal) pairs.push(['goals', opts.goal])
  if (opts.constraint) pairs.push(['constraints', opts.constraint])
  if (opts.team) pairs.push(['team', opts.team])
  if (opts.stack) pairs.push(['stack', opts.stack])
  if (opts.nonGoal) pairs.push(['nonGoals', opts.nonGoal])

  if (pairs.length === 0) {
    console.error(chalk.red('✗  Specify at least one context field: --goal, --constraint, --team, --stack, or --non-goal'))
    process.exit(1)
  }

  for (const [key, value] of pairs) {
    if (opts.action === 'remove') {
      removeContextFact(root, key, value)
      console.log(chalk.green(`✓  Removed from ${key}: ${value}`))
    } else {
      addContextFact(root, key, value)
      console.log(chalk.green(`✓  Added to ${key}: ${value}`))
    }
  }
}
