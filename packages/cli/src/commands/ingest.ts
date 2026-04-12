/**
 * chronicle ingest — index non-git sources (M3, v0.8.0)
 *
 * Processes all registered dir/url/pdf sources, creating chunk files in .lore/chunks/
 * Git sources are ingested via `chronicle add --repo` and don't need re-ingesting here.
 */

import chalk from 'chalk'
import ora from 'ora'
import { join } from 'path'
import { findLoreRoot, lorePath } from '@chronicle/core'
import { loadSourceRegistry, saveSourceRegistry, markIngested, ingestDir, ingestUrl, ingestPdf } from '@chronicle/core/unstable'

interface IngestOpts {
  id?: string      // ingest only this specific source
  force?: boolean  // re-ingest even if already ingested
}

export async function cmdIngest(opts: IngestOpts) {
  const root = findLoreRoot()
  if (!root) {
    process.stderr.write(chalk.red('✗  No .lore/ found. Run `chronicle init` first.\n'))
    process.exit(1)
  }

  let registry = loadSourceRegistry(root)
  const chunksDir = join(lorePath(root), 'chunks')

  const sources = registry.sources.filter(s => {
    if (s.type === 'git') return false  // git sources handled by `add --repo`
    if (opts.id && s.id !== opts.id) return false
    if (!opts.force && s.lastIngested) return false  // skip already-ingested
    return true
  })

  if (sources.length === 0) {
    console.log(chalk.yellow('\n  Nothing to ingest.'))
    console.log(chalk.dim('  Use `chronicle add --list` to see sources, `--force` to re-ingest.'))
    return
  }

  console.log(chalk.bold(`\n◆ Chronicle Ingest — ${sources.length} source(s)\n`))

  for (const source of sources) {
    const spinner = ora(`${source.type.padEnd(4)} ${source.label ?? source.id}`).start()
    try {
      let count = 0
      switch (source.type) {
        case 'dir': count = await ingestDir(source.id, source.path, chunksDir); break
        case 'url': count = await ingestUrl(source.id, source.path, chunksDir); break
        case 'pdf': count = await ingestPdf(source.id, source.path, chunksDir); break
      }
      registry = markIngested(registry, source.id)
      saveSourceRegistry(root, registry)
      spinner.succeed(`${source.id.padEnd(24)} ${chalk.green(count + ' chunks')}`)
    } catch (err) {
      spinner.fail(`${source.id.padEnd(24)} ${chalk.red(String(err).slice(0, 60))}`)
    }
  }

  console.log()
}
