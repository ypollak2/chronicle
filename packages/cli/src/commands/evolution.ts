import chalk from 'chalk'
import ora from 'ora'
import { readFileSync, existsSync } from 'fs'
import { findLoreRoot, readStore, writeStore, lorePath, buildEvolution, renderEvolutionMarkdown, mergeWithExisting, type Era } from '@chronicle/core'
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
    spinner.warn('No commit history found — nothing to build evolution from.')
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

/** Render an interactive HTML evolution timeline for `chronicle serve` */
export function renderEvolutionTimelineHtml(eras: Era[], projectName: string): string {
  const totalDecisions = eras.reduce((s, e) => s + e.decisions.length, 0)
  const totalRejections = eras.reduce((s, e) => s + e.rejections.length, 0)
  const maxDecisions = Math.max(1, ...eras.map(e => e.decisions.length))

  // Risk palette
  const riskColor = (r: string) =>
    r === 'high' ? '#f85149' : r === 'medium' ? '#d29922' : '#3fb950'

  // Era cards HTML
  const cards = eras.map((era, i) => {
    const pct = Math.round((era.decisions.length / maxDecisions) * 100)
    const isTagged = !era.tag.startsWith('phase-')
    const tagBadge = isTagged
      ? `<span class="era-tag">${era.tag}</span>`
      : `<span class="era-tag synthetic">${era.tag}</span>`

    const fromLabel = era.fromTag || 'Genesis'
    const toLabel = era.toDate === 'present' ? 'present' : era.toDate.slice(0, 10)
    const fromShort = era.fromDate.slice(0, 10)

    const decisionItems = era.decisions.slice(0, 6).map(d =>
      `<li class="dec-item" style="border-left:2px solid ${riskColor(d.risk)}">
        ${escHtml(d.title)}${d.isDeep ? ' <span class="adr-badge">ADR</span>' : ''}
      </li>`
    ).join('')
    const moreDecisions = era.decisions.length > 6
      ? `<li class="more-item">+${era.decisions.length - 6} more decisions</li>` : ''

    const rejectionItems = era.rejections.slice(0, 3).map(r =>
      `<li class="rej-item">✗ ${escHtml(r)}</li>`
    ).join('')

    const fileItems = era.keyFiles.slice(0, 4).map(f =>
      `<code>${escHtml(f)}</code>`
    ).join('\n')

    const capBar = `<div class="cap-bar"><div class="cap-fill" style="width:${pct}%"></div></div>`

    return `
    <div class="era-card" data-era="${i}">
      <div class="era-header">
        <div class="era-num">${String(i + 1).padStart(2, '0')}</div>
        <div class="era-meta">
          ${tagBadge}
          <span class="era-range">${fromLabel} → ${era.tag}</span>
          <span class="era-dates">${fromShort} – ${toLabel}</span>
        </div>
      </div>
      ${capBar}
      <div class="era-body">
        ${era.decisions.length ? `
          <div class="era-section">
            <div class="section-title">Decisions <span class="count">${era.decisions.length}</span></div>
            <ul class="dec-list">${decisionItems}${moreDecisions}</ul>
          </div>` : ''}
        ${era.rejections.length ? `
          <div class="era-section">
            <div class="section-title">Rejected approaches <span class="count">${era.rejections.length}</span></div>
            <ul class="rej-list">${rejectionItems}</ul>
          </div>` : ''}
        ${era.keyFiles.length ? `
          <div class="era-section">
            <div class="section-title">Most changed</div>
            <div class="file-chips">${fileItems}</div>
          </div>` : ''}
      </div>
      <div class="era-connector">${i < eras.length - 1 ? '↓' : '⬛'}</div>
    </div>`
  }).join('\n')

  // Cumulative chart data
  let cumulative = 0
  const chartBars = eras.map(era => {
    cumulative += era.decisions.length
    const h = Math.round((cumulative / Math.max(totalDecisions, 1)) * 80)
    return `<div class="chart-bar" style="height:${h}px" title="${era.tag}: ${era.decisions.length} new, ${cumulative} total"></div>`
  }).join('')

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(projectName)} — Evolution Timeline</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #0d1117; color: #c9d1d9; min-height: 100vh }
  .header { background: #161b22; border-bottom: 1px solid #30363d; padding: 16px 32px;
            display: flex; align-items: center; gap: 16px; position: sticky; top: 0; z-index: 20 }
  .header h1 { font-size: 17px; color: #e6edf3 }
  .header a { color: #58a6ff; font-size: 13px; text-decoration: none }
  .header a:hover { text-decoration: underline }
  .stat-pills { display: flex; gap: 8px; margin-left: auto }
  .pill { background: #21262d; border: 1px solid #30363d; border-radius: 20px;
          padding: 3px 10px; font-size: 12px; color: #8b949e }
  .pill span { color: #e6edf3; font-weight: 600 }
  .layout { display: flex; gap: 0 }
  .chart-panel { width: 200px; min-width: 200px; background: #161b22; border-right: 1px solid #30363d;
                 padding: 24px 16px; position: sticky; top: 57px; height: calc(100vh - 57px);
                 overflow-y: auto; flex-shrink: 0 }
  .chart-panel h3 { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 16px }
  .chart-bars { display: flex; align-items: flex-end; gap: 4px; height: 100px; padding: 0 4px }
  .chart-bar { flex: 1; background: #d2a8ff; border-radius: 2px 2px 0 0; min-height: 4px;
               transition: background .15s; cursor: pointer }
  .chart-bar:hover { background: #e0b3ff }
  .chart-axis { border-top: 1px solid #30363d; margin-top: 4px; padding-top: 6px;
                font-size: 10px; color: #8b949e; display: flex; justify-content: space-between }
  .legend { margin-top: 20px }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #8b949e; margin-bottom: 6px }
  .legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0 }
  .timeline { flex: 1; padding: 32px; max-width: 900px }
  .timeline-heading { font-size: 22px; font-weight: 700; color: #e6edf3; margin-bottom: 8px }
  .timeline-sub { color: #8b949e; font-size: 13px; margin-bottom: 32px }
  .era-card { background: #161b22; border: 1px solid #30363d; border-radius: 10px;
              margin-bottom: 16px; overflow: hidden; transition: border-color .15s }
  .era-card:hover { border-color: #d2a8ff44 }
  .era-header { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px 10px }
  .era-num { font-size: 28px; font-weight: 700; color: #30363d; font-variant-numeric: tabular-nums; width: 44px; flex-shrink: 0 }
  .era-meta { flex: 1 }
  .era-tag { display: inline-block; background: #d2a8ff22; color: #d2a8ff; border: 1px solid #d2a8ff44;
             border-radius: 4px; font-size: 11px; font-weight: 600; padding: 1px 6px; margin-bottom: 4px }
  .era-tag.synthetic { background: #3fb95022; color: #3fb950; border-color: #3fb95044 }
  .era-range { display: block; font-size: 14px; color: #e6edf3; font-weight: 600 }
  .era-dates { display: block; font-size: 11px; color: #8b949e; margin-top: 2px }
  .cap-bar { height: 3px; background: #21262d }
  .cap-fill { height: 100%; background: linear-gradient(90deg, #d2a8ff, #79c0ff); transition: width .3s }
  .era-body { padding: 12px 16px 16px; display: flex; flex-wrap: wrap; gap: 16px }
  .era-section { flex: 1; min-width: 200px }
  .section-title { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: .06em;
                   margin-bottom: 6px; display: flex; align-items: center; gap: 6px }
  .count { background: #21262d; border-radius: 10px; padding: 0 6px; font-size: 11px; color: #c9d1d9 }
  .dec-list, .rej-list { list-style: none }
  .dec-item { padding: 4px 8px; font-size: 12px; color: #c9d1d9; border-radius: 4px;
              margin-bottom: 3px; background: #0d111722 }
  .rej-item { padding: 3px 0; font-size: 12px; color: #8b949e }
  .more-item { font-size: 11px; color: #8b949e; padding: 3px 8px }
  .adr-badge { background: #1f6feb33; color: #58a6ff; border-radius: 3px; font-size: 10px;
               padding: 0 4px; border: 1px solid #1f6feb55 }
  .file-chips { display: flex; flex-wrap: wrap; gap: 4px }
  .file-chips code { background: #0d1117; border: 1px solid #30363d; border-radius: 4px;
                     padding: 2px 6px; font-size: 11px; color: #8b949e; font-family: 'SF Mono', Consolas, monospace }
  .era-connector { text-align: center; color: #30363d; padding: 4px 0; font-size: 18px }
</style>
</head><body>
<div class="header">
  <div style="color:#d2a8ff;font-size:18px">◈</div>
  <h1>${escHtml(projectName)} — Evolution Timeline</h1>
  <div class="stat-pills">
    <div class="pill"><span>${eras.length}</span> eras</div>
    <div class="pill"><span>${totalDecisions}</span> decisions</div>
    <div class="pill"><span>${totalRejections}</span> rejected</div>
  </div>
  <a href="/" style="margin-left:16px">← Overview</a>
</div>
<div class="layout">
  <div class="chart-panel">
    <h3>Decision velocity</h3>
    <div class="chart-bars">${chartBars}</div>
    <div class="chart-axis"><span>v1</span><span>now</span></div>
    <div class="legend" style="margin-top:20px">
      <div style="font-size:11px;color:#8b949e;margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Risk levels</div>
      <div class="legend-item"><div class="legend-dot" style="background:#f85149"></div> High risk</div>
      <div class="legend-item"><div class="legend-dot" style="background:#d29922"></div> Medium risk</div>
      <div class="legend-item"><div class="legend-dot" style="background:#3fb950"></div> Low risk</div>
    </div>
  </div>
  <div class="timeline">
    <div class="timeline-heading">${escHtml(projectName)}</div>
    <div class="timeline-sub">
      ${eras.length} development phases &nbsp;·&nbsp;
      ${totalDecisions} architectural decisions &nbsp;·&nbsp;
      ${totalRejections} rejected approaches
    </div>
    ${cards}
  </div>
</div>
</body></html>`
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
