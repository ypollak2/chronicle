import { Command } from 'commander'
import { cmdInit } from './commands/init.js'
import { cmdInject } from './commands/inject.js'
import { cmdDeepen } from './commands/deepen.js'
import { cmdHooksInstall, cmdHooksRemove, cmdCapture, cmdEnrichCommit } from './commands/hooks.js'
import { cmdSetup } from './commands/setup.js'
import { cmdDiagram } from './commands/diagram.js'
import { cmdGraph } from './commands/graph.js'
import { cmdEvolution } from './commands/evolution.js'
import { cmdDoctor } from './commands/doctor.js'
import { cmdSearch } from './commands/search.js'
import { cmdServe } from './commands/serve.js'
import { cmdSession } from './commands/session.js'
import { cmdMcp } from './commands/mcp.js'
import { cmdEval } from './commands/eval.js'
import { cmdAdd } from './commands/add.js'
import { cmdIngest } from './commands/ingest.js'
import { cmdMergeDriver } from './commands/merge-driver.js'
import { cmdRelate } from './commands/relate.js'
import { cmdContext } from './commands/context.js'
import { cmdWho } from './commands/who.js'
import { cmdVerify } from './commands/verify.js'
import { cmdProcess } from './commands/process.js'
import { cmdStatus } from './commands/status.js'
import { findLoreRoot } from '@chronicle/core'
import { getStoreStats, printStatusBefore, printStatusAfter } from './status.js'

const program = new Command()

program
  .name('chronicle')
  .description('AI-native development memory — markdown RAG for every AI coding tool')
  .version('0.9.0')

program
  .command('init')
  .description('Bootstrap .lore/ from git history')
  .option('-d, --depth <depth>', 'how far back to scan: 1month|3months|6months|1year|all', 'all')
  .option('--llm <provider>', 'LLM provider: auto|claude-code|codex|gemini|openai|anthropic|ollama', 'auto')
  .option('--limit <n>', 'cap commits to N most recent (use with deepen to process incrementally)')
  .option('--concurrency <n>', 'parallel LLM calls (default: 4 for API providers, 1 for ollama)')
  .action(cmdInit)

program
  .command('inject')
  .description('Output compressed context for the current session')
  .option('--files <files>', 'comma-separated files to scope context to')
  .option('--full', 'include all deep ADR files, not just index')
  .option('--format <format>', 'output format: markdown|xml|plain', 'markdown')
  .option('--min-confidence <n>', 'omit decisions below this confidence threshold (0.0–1.0)')
  .option('--top <n>', 'return only the N most relevant decisions')
  .option('--tokens <n>', 'auto-trim output to fit within N tokens (~4 chars/token)')
  .option('--no-stale', 'skip staleness detection (faster, no git log call)')
  .option('--query <text>', 'natural language query for semantic ranking (uses local embeddings)')
  .action(cmdInject)

program
  .command('deepen')
  .description('Extend the scan further back in history')
  .option('-d, --depth <depth>', 'new depth: 1year|all', '1year')
  .option('--llm <provider>', 'LLM provider: auto|claude-code|codex|gemini|openai|anthropic|ollama', 'auto')
  .option('--limit <n>', 'cap additional commits to N most recent')
  .option('--concurrency <n>', 'parallel LLM calls')
  .action(cmdDeepen)

program
  .command('doctor')
  .description('Validate .lore/ health — check files, links, cache, and hooks')
  .action(cmdDoctor)

program
  .command('search <query>')
  .description('Full-text search across .lore/ knowledge base')
  .option('--limit <n>', 'max results', '20')
  .option('--json', 'output results as JSON')
  .option('--semantic', 'vector similarity search (requires @huggingface/transformers)')
  .option('--hybrid', 'blend semantic + keyword scores (α=0.7 semantic)')
  .action(cmdSearch)

program
  .command('serve')
  .description('Start a local web viewer for .lore/')
  .option('--port <n>', 'port to listen on', '4242')
  .action(cmdServe)

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

program
  .command('graph')
  .description('Generate interactive HTML graph of module topology and decisions')
  .option('--output <file>', 'output filename (default: chronicle-graph.html)')
  .option('--no-open', 'do not open browser after generating')
  .option('--depth <n>', 'path segments to group by (default: 2)', '2')
  .option('--monorepo', 'force monorepo mode (auto-detected from packages/ apps/ dirs)')
  .action(cmdGraph)

const session = program.command('session').description('Manage session notes in .lore/sessions/')
session.command('save [message]').description('Save a session note with optional message').action((msg) => cmdSession({ action: 'save', message: msg }))
session.command('list').description('List saved session notes').action(() => cmdSession({ action: 'list' }))
session.command('show [n]').description('Show last N session notes (default: 1)').action((n) => cmdSession({ action: 'show', n }))

program
  .command('add')
  .description('Register a knowledge source (repo, directory, URL, or PDF)')
  .option('--repo <path>', 'git repository path or remote URL')
  .option('--dir <path>', 'local directory to index')
  .option('--url <url>', 'web page to index')
  .option('--pdf <path>', 'PDF file to index')
  .option('--label <name>', 'human-readable name for this source')
  .option('--list', 'list all registered sources')
  .option('--remove <id>', 'unregister a source by ID')
  .action(cmdAdd)

program
  .command('ingest')
  .description('Index registered non-git sources (dirs, URLs, PDFs)')
  .option('--id <id>', 'ingest only this source')
  .option('--force', 're-ingest even if already indexed')
  .action(cmdIngest)

program
  .command('eval')
  .description('Run RAG quality harness — measures recall, MRR, and confidence accuracy')
  .option('--init', 'bootstrap .lore/.eval.json test suite from existing decisions')
  .option('--json', 'output results as JSON')
  .option('--verbose', 'show per-case details')
  .action(cmdEval)

program
  .command('relate <title>')
  .description('Add a relationship between decisions (depends-on, supersedes, related-to)')
  .option('--depends-on <title>', 'this decision depends on another')
  .option('--supersedes <title>', 'this decision supersedes an older one')
  .option('--related-to <title>', 'this decision is related to another')
  .option('--list', 'show all decision relationships')
  .option('--diagram', 'render decision DAG as a Mermaid flowchart')
  .action((title, opts) => cmdRelate({ title, ...opts }))

const context = program.command('context').description('Manage project context (.lore/context.md)')
context.command('add').description('Add a context fact')
  .option('--goal <text>', 'a project goal')
  .option('--constraint <text>', 'a technical or business constraint')
  .option('--team <text>', 'a team member or team description')
  .option('--stack <text>', 'a technology in the stack')
  .option('--non-goal <text>', 'something explicitly out of scope')
  .action((opts) => cmdContext({ action: 'add', ...opts }))
context.command('remove').description('Remove a context fact')
  .option('--goal <text>')
  .option('--constraint <text>')
  .option('--team <text>')
  .option('--stack <text>')
  .option('--non-goal <text>')
  .action((opts) => cmdContext({ action: 'remove', ...opts }))
context.command('show').description('Print current project context').action(() => cmdContext({ action: 'show' }))
context.command('edit').description('Open context.md in $EDITOR').action(() => cmdContext({ action: 'edit' }))

program
  .command('who <file>')
  .description('Show owner and decisions for a file')
  .action(cmdWho)

program
  .command('mcp')
  .description('Start the MCP server for Claude Code integration (stdio transport)')
  .action(cmdMcp)

const hooks = program.command('hooks').description('Manage git hooks')
hooks.command('install').description('Install post-commit and prepare-commit-msg hooks').action(cmdHooksInstall)
hooks.command('remove').description('Remove Chronicle hooks from git').action(cmdHooksRemove)

program
  .command('status')
  .description('Single-line health summary: decisions, ADRs, sessions, unprocessed commits')
  .option('--json', 'output machine-readable JSON')
  .action(cmdStatus)

program
  .command('verify')
  .description('Check if .lore/ is up-to-date with recent commits (CI gate)')
  .option('--max-lag <n>', 'max unprocessed commits before failing', '5')
  .option('--json', 'output machine-readable JSON')
  .option('--quiet', 'suppress output, only print errors')
  .action(cmdVerify)

program
  .command('process')
  .description('Process all unprocessed commits and update .lore/ (for CI/GitHub Actions)')
  .option('-d, --depth <depth>', 'how far back to scan: 1month|3months|6months|1year|all', '1month')
  .option('--llm <provider>', 'LLM provider: auto|anthropic|openai|gemini|ollama', 'auto')
  .option('--from-commit <hash>', 'only process commits after this hash (e.g. github.event.before)')
  .option('--dry-run', 'show what would be processed without making changes')
  .action(cmdProcess)

// Internal commands (called by hooks/git, not for direct use)
program
  .command('merge-driver <base> <ours> <theirs>', { hidden: true })
  .option('--path <p>')
  .action((base, ours, theirs, opts) => cmdMergeDriver({ base, ours, theirs, path: opts.path }))


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
