/**
 * chronicle add — register additional knowledge sources (M2/M3, v0.8.0)
 *
 * Usage:
 *   chronicle add --repo /path/to/other-repo    # git repo
 *   chronicle add --repo https://github.com/...  # remote git (clones to ~/.chronicle/repos/)
 *   chronicle add --dir /path/to/docs            # local directory
 *   chronicle add --url https://example.com/doc  # web page
 *   chronicle add --pdf /path/to/spec.pdf        # PDF file
 *   chronicle add --list                         # show all registered sources
 *   chronicle add --remove <id>                  # unregister a source
 *
 * After adding a git repo, Chronicle extracts its decisions into a namespaced
 * section of .lore/ (decisions.{id}.md) so they're available in inject output.
 */

import chalk from 'chalk'
import { existsSync, mkdirSync } from 'fs'
import { join, resolve, basename } from 'path'
import { execSync } from 'child_process'
import {
  findLoreRoot,
  loadSourceRegistry, saveSourceRegistry,
  addSource, removeSource, listSources,
  deriveSourceId, markIngested,
  type SourceType,
} from '@chronicle/core'

interface AddOpts {
  repo?: string
  dir?: string
  url?: string
  pdf?: string
  label?: string
  list?: boolean
  remove?: string
}

export async function cmdAdd(opts: AddOpts) {
  const root = findLoreRoot()
  if (!root) {
    process.stderr.write(chalk.red('✗  No .lore/ found. Run `chronicle init` first.\n'))
    process.exit(1)
  }

  const registry = loadSourceRegistry(root)

  // ── List ──────────────────────────────────────────────────────────────────
  if (opts.list) {
    const sources = listSources(registry)
    if (sources.length === 0) {
      console.log(chalk.yellow('\n  No additional sources registered.'))
      console.log(chalk.dim('  chronicle add --repo /path/to/other-repo'))
      return
    }
    console.log(chalk.bold(`\n◆ Sources (${sources.length})\n`))
    for (const s of sources) {
      const ago = s.lastIngested
        ? chalk.dim(`  ingested ${new Date(s.lastIngested).toLocaleDateString()}`)
        : chalk.dim('  not yet ingested')
      console.log(`  ${chalk.cyan(s.id.padEnd(20))} ${chalk.bold(s.type.padEnd(5))}  ${s.path}${ago}`)
    }
    console.log()
    return
  }

  // ── Remove ────────────────────────────────────────────────────────────────
  if (opts.remove) {
    const updated = removeSource(registry, opts.remove)
    saveSourceRegistry(root, updated)
    console.log(chalk.green(`✓  Removed source: ${opts.remove}`))
    return
  }

  // ── Add ───────────────────────────────────────────────────────────────────
  const rawPath = opts.repo ?? opts.dir ?? opts.url ?? opts.pdf
  if (!rawPath) {
    process.stderr.write(chalk.red('✗  Specify a source: --repo, --dir, --url, or --pdf\n'))
    process.exit(1)
  }

  const type: SourceType = opts.repo ? 'git'
    : opts.dir ? 'dir'
    : opts.url ? 'url'
    : 'pdf'

  // For git repos: resolve path or clone remote
  let resolvedPath = rawPath
  if (type === 'git') {
    if (rawPath.startsWith('http://') || rawPath.startsWith('https://') || rawPath.startsWith('git@')) {
      resolvedPath = await cloneRepo(rawPath)
    } else {
      resolvedPath = resolve(rawPath)
      if (!existsSync(resolvedPath)) {
        process.stderr.write(chalk.red(`✗  Path not found: ${resolvedPath}\n`))
        process.exit(1)
      }
    }
  } else if (type === 'dir' || type === 'pdf') {
    resolvedPath = resolve(rawPath)
    if (!existsSync(resolvedPath)) {
      process.stderr.write(chalk.red(`✗  Path not found: ${resolvedPath}\n`))
      process.exit(1)
    }
  }

  const id = deriveSourceId(resolvedPath)
  const label = opts.label ?? (type === 'git' ? basename(resolvedPath) : basename(rawPath))

  const updated = addSource(registry, { id, type, path: resolvedPath, label })
  saveSourceRegistry(root, updated)
  console.log(chalk.green(`✓  Registered source: ${id}  (${type})`))
  console.log(chalk.dim(`   ${resolvedPath}`))

  // For git repos: run extraction immediately
  if (type === 'git') {
    console.log(chalk.dim(`\n  Extracting decisions from ${label}…`))
    await ingestGitSource(root, id, resolvedPath, updated)
    const final = markIngested(updated, id)
    saveSourceRegistry(root, final)
    console.log(chalk.green(`  ✓  Done — decisions available in .lore/`))
    console.log(chalk.dim(`\n  chronicle inject will now include context from: ${label}`))
  } else {
    console.log(chalk.dim(`\n  Run \`chronicle ingest\` to index this source.`))
  }
}

/** Clone a remote repo into ~/.chronicle/repos/<name> */
async function cloneRepo(url: string): Promise<string> {
  const name = url.split('/').pop()?.replace(/\.git$/, '') ?? 'repo'
  const cloneDir = join(process.env.HOME ?? '~', '.chronicle', 'repos', name)
  mkdirSync(join(process.env.HOME ?? '~', '.chronicle', 'repos'), { recursive: true })

  if (existsSync(cloneDir)) {
    process.stderr.write(chalk.dim(`  Updating existing clone at ${cloneDir}…\n`))
    try {
      execSync(`git -C "${cloneDir}" pull --ff-only`, { stdio: 'pipe' })
    } catch { /* non-fatal — may be detached HEAD etc. */ }
    return cloneDir
  }

  process.stderr.write(chalk.dim(`  Cloning ${url}…\n`))
  execSync(`git clone --depth=100 "${url}" "${cloneDir}"`, { stdio: 'pipe' })
  return cloneDir
}

/** Run chronicle init-style extraction on a secondary git repo */
async function ingestGitSource(
  primaryRoot: string,
  sourceId: string,
  repoPath: string,
  registry: import('@chronicle/core').SourceRegistry
) {
  try {
    const {
      getCommits, extractFromCommits, createFileCache,
      writeStore, appendToStore, writeDeepDecision,
    } = await import('@chronicle/core')
    const { makeLLMProvider, detectProvider } = await import('../llm.js')
    const { formatRejectionEntry, formatDeepADR, slugify } = await import('../format.js')

    const provider = detectProvider()
    const llm = makeLLMProvider(provider)
    const commits = getCommits(repoPath, '1year')
    if (commits.length === 0) {
      console.log(chalk.dim('  No commits found.'))
      return
    }

    const cache = createFileCache(primaryRoot)  // shared cache keyed by SHA
    const uncached = commits.filter(c => !cache.has(c.hash))

    if (uncached.length === 0) {
      console.log(chalk.dim(`  All ${commits.length} commits already cached.`))
      return
    }

    const results = await extractFromCommits(uncached, llm, { strategy: 'clustered', cache, concurrency: 2 })

    // Write decisions to a namespaced file: decisions.{sourceId}.md
    const decisions = results.filter(r => r.isDecision)
    const rows = decisions.map(d => {
      const title = (d.title ?? '').slice(0, 50)
      const affects = (d.affects ?? []).join(', ').slice(0, 40)
      const conf = typeof d.confidence === 'number' && d.confidence < 1.0
        ? ` <!-- confidence:${d.confidence.toFixed(2)} -->`
        : ''
      return `| ${d.date ?? ''} | ${title} | ${affects} | ${d.risk ?? 'low'} | |${conf}`
    }).join('\n')

    writeStore(primaryRoot, `decisions.${sourceId}` as any,
      `# Decision Log — ${sourceId}\n\n| Date | Decision | Affects | Risk | ADR |\n|------|----------|---------|------|-----|\n${rows}\n`)

    for (const r of results.filter(r => r.isRejection)) {
      appendToStore(primaryRoot, 'rejected', formatRejectionEntry(r))
    }
    for (const d of decisions.filter(d => d.isDeep)) {
      writeDeepDecision(primaryRoot, slugify(`${sourceId}-${d.title ?? 'decision'}`), formatDeepADR(d))
    }

    console.log(chalk.dim(`  ${decisions.length} decisions, ${results.filter(r => r.isRejection).length} rejections`))
  } catch (err) {
    process.stderr.write(chalk.yellow(`  ⚠  Extraction failed: ${err}\n`))
  }
}
