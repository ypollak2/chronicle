import ora from 'ora'
import chalk from 'chalk'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  findLoreRoot, initStore, lorePath, writeStore, appendToStore, writeDeepDecision,
  getCommits, extractFromCommits, createFileCache, parseExtractionResponse,
  buildEvolution, renderEvolutionMarkdown,
  type ScanDepth, type ExtractionResult
} from '@chronicle/core'
import { makeLLMProvider, detectProvider } from '../llm.js'
import { formatDecisionEntry, formatRejectionEntry, formatDeepADR, slugify } from '../format.js'
import { cmdHooksInstall } from './hooks.js'

export async function cmdInit(opts: { depth: string; llm: string; limit?: string; concurrency?: string }) {
  const cwd = process.cwd()
  const depth = opts.depth as ScanDepth
  const limit = opts.limit ? parseInt(opts.limit, 10) : undefined
  const resolvedLlm = opts.llm === 'auto' ? detectProvider() : opts.llm
  const concurrency = opts.concurrency
    ? parseInt(opts.concurrency, 10)
    : resolvedLlm === 'ollama' ? 1
    : (resolvedLlm === 'claude-code' || resolvedLlm === 'codex') ? 2
    : 4

  // Validate we're in a git repo
  if (!existsSync(join(cwd, '.git'))) {
    console.error(chalk.red('✗  Not a git repository. Run `git init` first.'))
    process.exit(1)
  }

  const isResume = existsSync(join(cwd, '.lore'))
  if (isResume) {
    console.log(chalk.bold('\n◆ Chronicle — resuming\n'))
    console.log(chalk.dim('  .lore/ exists — skipping already-processed commits (cache hit)\n'))
  } else {
    console.log(chalk.bold('\n◆ Chronicle — initializing\n'))
  }
  console.log(chalk.dim(`  provider: ${resolvedLlm}  concurrency: ${concurrency}  depth: ${depth}\n`))

  // Phase 1: scaffold the store (no-op if already exists)
  initStore(cwd)
  const spinner = ora('Scanning git history...').start()

  // Phase 2: collect commits
  const commits = getCommits(cwd, depth, limit)

  if (commits.length === 0) {
    spinner.warn('No meaningful commits found. Check --depth or try --depth=all')
    writeBootstrapPlaceholder(cwd, depth)
    await cmdHooksInstall({ silent: true })
    return
  }

  const cache = createFileCache(cwd)
  const uncached = commits.filter(c => !cache.has(c.hash))

  if (uncached.length === 0) {
    spinner.succeed(chalk.green(`All ${commits.length} commits already processed — .lore/ is up to date`))
    await cmdHooksInstall({ silent: true })
    return
  }

  spinner.text = `${commits.length} commits found, ${uncached.length} to process...`

  // Phase 3: extract decisions (cached by SHA — safe to interrupt and re-run)
  const llm = makeLLMProvider(resolvedLlm)
  let done = 0

  const results = await extractFromCommits(commits, async (prompt) => {
    const result = await llm(prompt)
    done = Math.min(done + 6, uncached.length)   // approx batch size
    spinner.text = `Processing commits... ${done}/${uncached.length} (${Math.round(done/uncached.length*100)}%)`
    return result
  }, { strategy: 'simple', cache, concurrency })

  // Phase 4: write to store
  spinner.text = 'Writing knowledge base...'
  buildStore(cwd, results)

  // Phase 5: build evolution record from git tags
  spinner.text = 'Building evolution record...'
  const eras = buildEvolution(cwd)
  if (eras.length > 0) {
    writeStore(cwd, 'evolution', renderEvolutionMarkdown(eras))
  }

  spinner.succeed(chalk.green(`Done! Processed ${uncached.length} commits (${commits.length} total in history)`))

  // Phase 6: always install git hooks
  await cmdHooksInstall({ silent: true })

  const decisions = results.filter(r => r.isDecision)
  const rejections = results.filter(r => r.isRejection)
  const deep = decisions.filter(r => r.isDeep)

  console.log(`
  ${chalk.bold('Knowledge base:')}
  ${chalk.cyan(decisions.length)} decisions logged
  ${chalk.red(rejections.length)} rejections captured  ${chalk.dim('← what was tried & abandoned')}
  ${chalk.yellow(deep.length)} deep ADRs generated

  ${chalk.green('✓')} Git hooks installed — .lore/ updates automatically after every commit

  ${chalk.bold('Next steps:')}
  ${chalk.dim('chronicle inject')}                     — pipe context into your AI tool
  ${chalk.dim('chronicle setup --tool claude-code')}   — wire MCP + session context
  ${chalk.dim('chronicle serve')}                      — browse .lore/ in the web viewer
  `)
}

function buildStore(root: string, results: ExtractionResult[]) {
  const decisions = results.filter(r => r.isDecision)
  const rejections = results.filter(r => r.isRejection)

  // decisions.md — lightweight index
  const tableRows = decisions.map(d => {
    const title = d.title ?? 'Unnamed decision'
    const affects = (d.affects ?? []).join(', ')
    const date = d.date ?? ''
    const conf = typeof d.confidence === 'number' ? d.confidence : 1.0
    const confTag = conf < 1.0 ? ` <!-- confidence:${conf.toFixed(2)} -->` : ''
    return `| ${date} | ${title.slice(0, 50)} | ${affects.slice(0, 40)} | ${d.risk ?? 'low'} |${d.isDeep ? ` [→](decisions/${slugify(title)}.md)` : ''} |${confTag}`
  }).join('\n')

  writeStore(root, 'decisions', `# Decision Log\n\n| Date | Decision | Affects | Risk | ADR |\n|------|----------|---------|------|-----|\n${tableRows}\n`)

  // rejected.md — append each rejection
  for (const r of rejections) {
    appendToStore(root, 'rejected', formatRejectionEntry(r))
  }

  // deep ADR files for complex decisions
  for (const d of decisions.filter(r => r.isDeep)) {
    const title = d.title ?? 'unnamed-decision'
    writeDeepDecision(root, slugify(title), formatDeepADR(d))
  }
}

function writeBootstrapPlaceholder(root: string, depth: ScanDepth) {
  writeStore(root, 'decisions', `# Decision Log\n\n_No commits found in depth: ${depth}. Run \`chronicle deepen --depth=all\` to scan full history._\n`)
  writeStore(root, 'index', `# Project Index\n\n_Generated by Chronicle — run \`chronicle deepen\` to populate._\n`)
}
