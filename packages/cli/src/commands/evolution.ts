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
      ${i < eras.length - 1 ? '<div class="era-connector">↓</div>' : ''}
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0f1419; --surface: #171c22; --surface-hi: #1b2026; --surface-top: #252a30;
    --border: rgba(255,255,255,0.06); --primary: #81da8c; --primary-dim: #2f8743;
    --text: #bfcabb; --text-hi: #e8ece7; --text-lo: #6b7280; --mono: ui-monospace, 'Cascadia Code', monospace;
    --red: #f85149; --amber: #d29922; --green: #3fb950;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
  body { font: 14px/1.5 'Inter', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh }
  .top-bar { background: var(--surface); padding: 0 32px; height: 52px; display: flex;
              align-items: center; gap: 16px; position: sticky; top: 0; z-index: 20;
              border-bottom: 1px solid var(--border) }
  .brand { font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 700;
           color: var(--primary); letter-spacing: -0.02em; display: flex; align-items: center; gap: 8px }
  .stat-pills { display: flex; gap: 8px; margin-left: auto }
  .pill { background: var(--surface-hi); border-radius: 20px; padding: 3px 12px;
          font-size: 11px; color: var(--text-lo); font-family: var(--mono) }
  .pill b { color: var(--text-hi); font-weight: 600 }
  .back-link { font-size: 12px; color: var(--text-lo); text-decoration: none; font-family: var(--mono);
               padding: 4px 10px; border-radius: 4px; background: var(--surface-hi); margin-left: 12px;
               transition: color .15s, background .15s }
  .back-link:hover { color: var(--primary); background: var(--surface-top) }
  .layout { display: flex; gap: 0 }
  .chart-panel { width: 192px; min-width: 192px; background: var(--surface); padding: 24px 16px;
                 position: sticky; top: 52px; height: calc(100vh - 52px); overflow-y: auto; flex-shrink: 0 }
  .chart-panel h3 { font-size: 10px; font-family: var(--mono); color: var(--text-lo);
                    text-transform: uppercase; letter-spacing: .1em; margin-bottom: 16px }
  .chart-bars { display: flex; align-items: flex-end; gap: 3px; height: 90px; padding: 0 2px }
  .chart-bar { flex: 1; background: var(--primary); border-radius: 2px 2px 0 0; min-height: 6px;
               opacity: .7; transition: opacity .15s; cursor: pointer }
  .chart-bar:hover { opacity: 1 }
  .chart-axis { border-top: 1px solid var(--border); margin-top: 4px; padding-top: 6px;
                font-size: 10px; color: var(--text-lo); display: flex; justify-content: space-between;
                font-family: var(--mono) }
  .risk-legend { margin-top: 24px }
  .risk-label { font-size: 10px; font-family: var(--mono); color: var(--text-lo);
                text-transform: uppercase; letter-spacing: .1em; margin-bottom: 10px }
  .legend-item { display: flex; align-items: center; gap: 7px; font-size: 12px;
                 color: var(--text); margin-bottom: 7px }
  .legend-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0 }
  .timeline { flex: 1; padding: 32px 36px; max-width: 880px }
  .timeline-heading { font-family: 'Space Grotesk', sans-serif; font-size: 24px; font-weight: 700;
                      color: var(--text-hi); margin-bottom: 6px; letter-spacing: -0.02em }
  .timeline-sub { color: var(--text-lo); font-size: 13px; margin-bottom: 32px; font-family: var(--mono) }
  .era-card { background: var(--surface); border-radius: 8px; margin-bottom: 12px;
              overflow: hidden; transition: background .15s }
  .era-card:hover { background: var(--surface-hi) }
  .era-header { display: flex; align-items: flex-start; gap: 14px; padding: 14px 18px 10px }
  .era-num { font-family: 'Space Grotesk', sans-serif; font-size: 26px; font-weight: 700;
             color: var(--border); font-variant-numeric: tabular-nums; width: 44px; flex-shrink: 0;
             color: rgba(255,255,255,0.1) }
  .era-meta { flex: 1 }
  .era-tag { display: inline-block; background: rgba(129,218,140,0.12); color: var(--primary);
             border-radius: 3px; font-size: 10px; font-weight: 600; padding: 1px 6px; margin-bottom: 5px;
             font-family: var(--mono); letter-spacing: .03em }
  .era-tag.synthetic { background: rgba(63,185,80,0.1); color: var(--green) }
  .era-range { display: block; font-size: 14px; color: var(--text-hi); font-weight: 600;
               font-family: 'Space Grotesk', sans-serif }
  .era-dates { display: block; font-size: 11px; color: var(--text-lo); margin-top: 3px;
               font-family: var(--mono) }
  .cap-bar { height: 2px; background: var(--surface-hi) }
  .cap-fill { height: 100%; background: linear-gradient(90deg, var(--primary), #79c0ff); transition: width .3s }
  .era-body { padding: 12px 18px 18px; display: flex; flex-wrap: wrap; gap: 16px }
  .era-section { flex: 1; min-width: 200px }
  .section-title { font-size: 10px; font-family: var(--mono); color: var(--text-lo);
                   text-transform: uppercase; letter-spacing: .1em;
                   margin-bottom: 8px; display: flex; align-items: center; gap: 6px }
  .count { background: var(--surface-top); border-radius: 8px; padding: 0 6px;
           font-size: 10px; color: var(--text) }
  .dec-list, .rej-list { list-style: none }
  .dec-item { padding: 4px 8px; font-size: 12px; color: var(--text); border-radius: 4px;
              margin-bottom: 3px; border-left: 2px solid transparent }
  .rej-item { padding: 3px 0; font-size: 12px; color: var(--text-lo) }
  .more-item { font-size: 11px; color: var(--text-lo); padding: 3px 8px; font-family: var(--mono) }
  .adr-badge { background: rgba(88,166,255,0.1); color: #58a6ff; border-radius: 3px; font-size: 10px;
               padding: 0 4px; font-family: var(--mono) }
  .file-chips { display: flex; flex-wrap: wrap; gap: 4px }
  .file-chips code { background: var(--bg); border-radius: 3px; padding: 2px 6px; font-size: 10px;
                     color: var(--text-lo); font-family: var(--mono) }
  .era-connector { text-align: center; color: rgba(129,218,140,0.25); padding: 2px 0; font-size: 16px }
</style>
</head><body>
<div class="top-bar">
  <div class="brand">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h14M3 18h10"/></svg>
    EVOLUTION TIMELINE
  </div>
  <span style="color:var(--text-lo);font-size:13px;font-family:var(--mono)">${escHtml(projectName)}</span>
  <div class="stat-pills">
    <div class="pill"><b>${eras.length}</b> eras</div>
    <div class="pill"><b>${totalDecisions}</b> decisions</div>
    <div class="pill"><b>${totalRejections}</b> rejected</div>
  </div>
  <a href="/" class="back-link">← Overview</a>
</div>
<div class="layout">
  <div class="chart-panel">
    <h3>Decision velocity</h3>
    <div class="chart-bars">${chartBars}</div>
    <div class="chart-axis"><span>v1</span><span>now</span></div>
    <div class="risk-legend">
      <div class="risk-label">Risk levels</div>
      <div class="legend-item"><div class="legend-dot" style="background:#f85149"></div> High</div>
      <div class="legend-item"><div class="legend-dot" style="background:#d29922"></div> Medium</div>
      <div class="legend-item"><div class="legend-dot" style="background:#3fb950"></div> Low</div>
    </div>
  </div>
  <div class="timeline">
    <div class="timeline-heading">${escHtml(projectName)}</div>
    <div class="timeline-sub">
      ${eras.length} development phase${eras.length !== 1 ? 's' : ''}
      ${totalDecisions > 0 ? ` · ${totalDecisions} decisions` : ''}
      ${totalRejections > 0 ? ` · ${totalRejections} rejected` : ''}
      ${totalDecisions === 0 ? ' · <span style="color:var(--text-lo)">run <code style="background:var(--surface);padding:2px 5px;border-radius:3px;color:#f0883e">chronicle init</code> to populate</span>' : ''}
    </div>
    ${cards}
  </div>
</div>
</body></html>`
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
