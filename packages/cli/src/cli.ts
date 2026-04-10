#!/usr/bin/env node
import { Command } from 'commander'
import { cmdInit } from './commands/init.js'
import { cmdInject } from './commands/inject.js'
import { cmdDeepen } from './commands/deepen.js'
import { cmdHooksInstall, cmdHooksRemove, cmdCapture, cmdEnrichCommit } from './commands/hooks.js'

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

program.parse()
