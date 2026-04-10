#!/usr/bin/env node
import { Command } from 'commander'
import { cmdInit } from './commands/init.js'
import { cmdInject } from './commands/inject.js'
import { cmdDeepen } from './commands/deepen.js'
import { cmdHooksInstall, cmdHooksRemove, cmdCapture, cmdEnrichCommit } from './commands/hooks.js'
import { cmdSetup } from './commands/setup.js'
import { cmdDiagram } from './commands/diagram.js'
import { cmdEvolution } from './commands/evolution.js'
import { findLoreRoot } from '@chronicle/core'
import { getStoreStats, printStatusBefore, printStatusAfter } from './status.js'

const program = new Command()

program
  .name('chronicle')
  .description('AI-native development memory — markdown RAG for every AI coding tool')
  .version('0.1.0')

program
  .command('init')
  .description('Bootstrap .lore/ from git history')
  .option('-d, --depth <depth>', 'how far back to scan: 1month|3months|6months|1year|all', '6months')
  .option('--llm <provider>', 'LLM provider: anthropic|openai|gemini', 'anthropic')
  .action(cmdInit)

program
  .command('inject')
  .description('Output compressed context for the current session')
  .option('--files <files>', 'comma-separated files to scope context to')
  .option('--full', 'include all deep ADR files, not just index')
  .option('--format <format>', 'output format: markdown|xml|plain', 'markdown')
  .action(cmdInject)

program
  .command('deepen')
  .description('Extend the scan further back in history')
  .option('-d, --depth <depth>', 'new depth: 1year|all', '1year')
  .action(cmdDeepen)

program
  .command('setup')
  .description('Install integration for a specific AI tool')
  .option('--tool <tool>', 'tool name: claude-code|cursor|aider|gemini-cli|copilot|codex|opencode|trae|factory|openclaw')
  .option('--all', 'install all available integrations')
  .action(cmdSetup)

program
  .command('evolution')
  .description('Build or view the system evolution record (.lore/evolution.md)')
  .option('--regen', 'force regenerate even if evolution.md already exists')
  .option('--view', 'print current evolution record to stdout')
  .action(cmdEvolution)

program
  .command('diagram')
  .description('Generate ASCII diagrams from .lore/ store')
  .option('--type <type>', 'architecture|dependencies|evolution (default: all)')
  .action(cmdDiagram)

const hooks = program.command('hooks').description('Manage git hooks')
hooks.command('install').description('Install post-commit and prepare-commit-msg hooks').action(cmdHooksInstall)
hooks.command('remove').description('Remove Chronicle hooks from git').action(cmdHooksRemove)

// Internal commands (called by hooks, not for direct use)
program
  .command('capture', { hidden: true })
  .option('--from-commit <hash>')
  .option('--llm <provider>')
  .action(cmdCapture)

program
  .command('enrich-commit <msgFile>', { hidden: true })
  .action((msgFile) => cmdEnrichCommit({ msgFile }))

// Status bar: show before/after for write commands (not inject/mcp/internal)
const WRITE_COMMANDS = new Set(['init', 'deepen', 'capture', 'setup', 'diagram', 'evolution'])

program.hook('preAction', (thisCommand) => {
  const name = thisCommand.name()
  if (!WRITE_COMMANDS.has(name)) return
  const root = findLoreRoot()
  if (!root) return
  ;(thisCommand as any)._chronicleStats = getStoreStats(root)
  printStatusBefore(root, name)
})

program.hook('postAction', (thisCommand) => {
  const name = thisCommand.name()
  if (!WRITE_COMMANDS.has(name)) return
  const root = findLoreRoot()
  const before = (thisCommand as any)._chronicleStats
  if (!root || !before) return
  printStatusAfter(root, before)
})

program.parse()
