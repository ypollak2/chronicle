/**
 * chronicle quickstart — interactive 5-minute setup wizard.
 *
 * Guides a new user from zero to a working .lore/ with:
 *   1. Git repo check
 *   2. chronicle init (or resume)
 *   3. chronicle migrate (bring schema up to date)
 *   4. chronicle hooks install
 *   5. chronicle setup --tool <choice>
 *   6. Print next-steps summary
 *
 * Non-interactive mode (--yes) accepts all defaults and runs unattended.
 */

import chalk from 'chalk'
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import * as readline from 'readline'
import { findLoreRoot } from '@chronicle/core'
import { cmdInit } from './init.js'
import { cmdHooksInstall } from './hooks.js'
import { cmdSetup } from './setup.js'
import { cmdMigrate } from './migrate.js'
import { ALL_TOOLS } from '../adapters/index.js'

const STEP_COUNT = 5

function step(n: number, label: string) {
  console.log(chalk.bold(`\n[${n}/${STEP_COUNT}] ${label}`))
}

async function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve))
}

async function confirm(rl: readline.Interface, prompt: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]'
  const answer = await ask(rl, `${prompt} ${hint} `)
  if (!answer.trim()) return defaultYes
  return answer.trim().toLowerCase().startsWith('y')
}

export async function cmdQuickstart(opts: { yes?: boolean; llm?: string; depth?: string }) {
  console.log(chalk.bold('\n◆ Chronicle Quickstart — zero to first inject in 5 minutes\n'))
  console.log(chalk.dim('  This wizard will initialize .lore/, install git hooks, and wire your AI tool.\n'))

  const nonInteractive = opts.yes ?? false
  const rl = nonInteractive
    ? null
    : readline.createInterface({ input: process.stdin, output: process.stdout })

  const close = () => rl?.close()

  // ─── Step 1: Git repo check ───────────────────────────────────────────────
  step(1, 'Checking git repository')
  const cwd = process.cwd()
  const isGit = existsSync(join(cwd, '.git')) || (() => {
    try { execSync('git rev-parse --git-dir', { stdio: 'pipe' }); return true } catch { return false }
  })()

  if (!isGit) {
    console.error(chalk.red('\n  ✗  Not a git repository.'))
    console.error(chalk.dim('     Run `git init && git add . && git commit -m "initial"` first, then re-run quickstart.'))
    close()
    process.exit(1)
  }
  console.log(chalk.green('  ✓  Git repository found.'))

  // ─── Step 2: chronicle init ───────────────────────────────────────────────
  step(2, 'Initializing .lore/ knowledge base')
  const existing = findLoreRoot()

  if (existing) {
    console.log(chalk.dim('  .lore/ already exists — running chronicle migrate to update schema.\n'))
  } else {
    const depth = opts.depth ?? '3months'
    const llm = opts.llm ?? 'auto'

    if (!nonInteractive) {
      const chosenDepth = await ask(rl!, `  How far back should we scan? [1month/3months/6months/1year/all] (${depth}): `)
      const resolvedDepth = chosenDepth.trim() || depth
      console.log('')
      await cmdInit({ depth: resolvedDepth, llm, limit: undefined, concurrency: undefined })
    } else {
      await cmdInit({ depth, llm, limit: undefined, concurrency: undefined })
    }
  }

  // ─── Step 3: migrate schema ───────────────────────────────────────────────
  step(3, 'Migrating schema to current version')
  await cmdMigrate({})

  // ─── Step 4: git hooks ────────────────────────────────────────────────────
  step(4, 'Installing git hooks')
  const installHooks = nonInteractive || await confirm(rl!, '  Install post-commit hook (auto-updates .lore/ after each commit)?')
  if (installHooks) {
    await cmdHooksInstall({ silent: false })
    console.log(chalk.green('  ✓  Git hooks installed.'))
  } else {
    console.log(chalk.dim('  Skipped. Run `chronicle hooks install` later.'))
  }

  // ─── Step 5: AI tool setup ────────────────────────────────────────────────
  step(5, 'Setting up AI tool integration')
  console.log(chalk.dim('\n  Available integrations:'))
  for (const t of ALL_TOOLS) {
    console.log(chalk.dim(`    ${t}`))
  }

  let chosenTool: string | null = null

  if (nonInteractive) {
    // Auto-detect Claude Code as the default
    chosenTool = 'claude-code'
  } else {
    const answer = await ask(rl!, '\n  Which AI tool do you use? (Enter tool name, or press Enter to skip): ')
    chosenTool = answer.trim() || null
  }

  if (chosenTool && (ALL_TOOLS as readonly string[]).includes(chosenTool)) {
    await cmdSetup({ tool: chosenTool })
  } else if (chosenTool) {
    console.log(chalk.yellow(`  ⚠  Unknown tool "${chosenTool}". Run \`chronicle setup --tool <name>\` manually.`))
  } else {
    console.log(chalk.dim('  Skipped. Run `chronicle setup --tool <name>` when ready.'))
  }

  close()

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(chalk.bold('\n◆ Setup complete!\n'))
  console.log([
    `  ${chalk.green('✓')} .lore/ initialized with your git history`,
    `  ${chalk.green('✓')} Schema migrated to current version`,
    installHooks ? `  ${chalk.green('✓')} Git hooks active — .lore/ updates after every commit` : '',
    ``,
    chalk.bold('  Try it now:'),
    `  ${chalk.cyan('chronicle inject')}          — pipe context to your AI tool`,
    `  ${chalk.cyan('chronicle search <query>')}  — search the knowledge base`,
    `  ${chalk.cyan('chronicle status')}          — see a health summary`,
    `  ${chalk.cyan('chronicle doctor')}          — run a full diagnostics check`,
    ``,
    chalk.dim('  Full docs: https://github.com/ypollak2/chronicle'),
  ].filter(Boolean).join('\n'))
}
