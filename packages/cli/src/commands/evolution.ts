import chalk from 'chalk'
import ora from 'ora'
import { readFileSync, existsSync } from 'fs'
import { findLoreRoot, readStore, writeStore, lorePath, buildEvolution, renderEvolutionMarkdown, mergeWithExisting } from '@chronicle/core'
import { execSync } from 'child_process'

export async function cmdEvolution(opts: { regen?: boolean; view?: boolean }) {
  const root = findLoreRoot()
  if (!root) {
    console.error(chalk.red('✗  No .lore/ found. Run `chronicle init` first.'))
    process.exit(1)
  }

  const evolutionPath = root + '/.lore/evolution.md'
  const hasExisting = existsSync(evolutionPath)

  // --view: just print current evolution.md
  if (opts.view && hasExisting) {
    process.stdout.write(readFileSync(evolutionPath, 'utf8'))
    return
  }

  if (hasExisting && !opts.regen) {
    console.log(chalk.dim('evolution.md already exists. Use --regen to rebuild it.'))
    console.log(chalk.dim('Use --view to print the current evolution record.'))
    return
  }

  const spinner = ora('Building evolution record from git history...').start()

  const eras = buildEvolution(root)

  if (eras.length === 0) {
    spinner.warn('No git tags found. Tag a release first: git tag v0.1.0')
    writeStore(root, 'evolution',
      '# System Evolution\n\n_No releases tagged yet. Run `git tag v0.1.0` to create your first era._\n'
    )
    return
  }

  spinner.text = `Found ${eras.length} era${eras.length === 1 ? '' : 's'} — writing evolution.md...`

  // Get project name from package.json or git remote
  const projectName = detectProjectName(root)

  const newMd = renderEvolutionMarkdown(eras, projectName)

  // Preserve any manually-written summaries from the existing file
  const finalMd = hasExisting
    ? mergeWithExisting(newMd, readFileSync(evolutionPath, 'utf8'))
    : newMd

  writeStore(root, 'evolution', finalMd)

  spinner.succeed(chalk.green(`evolution.md written — ${eras.length} era${eras.length === 1 ? '' : 's'}`))

  // Print a quick summary
  for (const era of eras) {
    const label = era.tag === 'HEAD (current)' ? chalk.cyan(era.tag) : chalk.bold(era.tag)
    const period = `${era.fromDate.slice(0, 10)} → ${era.toDate === 'present' ? chalk.green('present') : era.toDate.slice(0, 10)}`
    const counts = [
      era.decisions.length ? `${era.decisions.length} decisions` : '',
      era.rejections.length ? `${era.rejections.length} rejections` : '',
    ].filter(Boolean).join(', ')

    console.log(`  ${label.padEnd(30)} ${chalk.dim(period)}  ${chalk.dim(counts)}`)
  }

  console.log(chalk.dim('\n  chronicle evolution --view   — print full record'))
}

function detectProjectName(root: string): string {
  // Try package.json first
  const pkgPath = root + '/package.json'
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (pkg.name) return pkg.name
    } catch { /* fall through */ }
  }

  // Try git remote name
  try {
    const remote = execSync(`git -C "${root}" remote get-url origin`, { stdio: ['pipe', 'pipe', 'ignore'] })
      .toString().trim()
    const match = remote.match(/\/([^/]+?)(?:\.git)?$/)
    if (match) return match[1]
  } catch { /* fall through */ }

  return 'Project'
}
