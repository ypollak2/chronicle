import chalk from 'chalk'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, extname } from 'path'
import { findLoreRoot, lorePath, readStore, buildEvolution } from '@chronicle/core'
import { buildGraphData } from '../graph.js'
import { renderGraphHtml } from './graph.js'
import { renderEvolutionTimelineHtml } from './evolution.js'

export async function cmdServe(opts: { port?: string }) {
  const root = findLoreRoot()
  if (!root) {
    console.error(chalk.red('✗  No .lore/ found. Run `chronicle init` first.'))
    process.exit(1)
  }

  const port = parseInt(opts.port ?? '4242', 10)
  const loreDir = lorePath(root)

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/'

    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(renderIndex(root, loreDir))
      return
    }

    if (url.startsWith('/file/')) {
      const rel = decodeURIComponent(url.slice(6))
      const full = join(loreDir, rel)
      // Security: ensure path stays inside loreDir
      if (!full.startsWith(loreDir) || !existsSync(full)) {
        res.writeHead(404); res.end('Not found'); return
      }
      const content = readFileSync(full, 'utf8')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(renderFile(rel, content))
      return
    }

    if (url === '/api/search') {
      const q = new URL(url, `http://localhost`).searchParams.get('q') ?? ''
      const results = searchLore(loreDir, q, 50)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(results))
      return
    }

    if (url === '/api/graph') {
      const data = buildGraphData(root)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
      return
    }

    if (url === '/graph') {
      const projectName = root.split('/').pop() ?? 'project'
      const data = buildGraphData(root)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(renderGraphHtml(data, projectName))
      return
    }

    if (url === '/api/evolution') {
      const eras = buildEvolution(root)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(eras))
      return
    }

    if (url === '/evolution-timeline') {
      const projectName = root.split('/').pop() ?? 'project'
      const eras = buildEvolution(root)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(renderEvolutionTimelineHtml(eras, projectName))
      return
    }

    res.writeHead(404); res.end('Not found')
  })

  server.listen(port, () => {
    console.log(chalk.bold(`\n◆ Chronicle Viewer\n`))
    console.log(`  ${chalk.cyan(`http://localhost:${port}`)}  — press Ctrl+C to stop\n`)
    // Attempt to open browser (best-effort)
    try {
      const { execSync } = require('child_process')
      const open = process.platform === 'darwin' ? 'open'
        : process.platform === 'win32' ? 'start'
        : 'xdg-open'
      execSync(`${open} http://localhost:${port}`, { stdio: 'ignore' })
    } catch { /* no browser */ }
  })
}

function renderIndex(root: string, loreDir: string): string {
  const decisions = readStore(root, 'decisions')
  const rejected = readStore(root, 'rejected')
  const evolution = readStore(root, 'evolution')
  const index = readStore(root, 'index')
  const projectName = root.split('/').pop() ?? 'project'

  const adrDir = join(loreDir, 'decisions')
  const adrs = existsSync(adrDir)
    ? readdirSync(adrDir).filter(f => f.endsWith('.md')).map(f => ({
        name: f.replace(/-/g, ' ').replace('.md', ''),
        file: `decisions/${f}`,
      }))
    : []

  const decCount = Math.max(0, (decisions?.match(/^\|/gm) ?? []).length - 2)
  const rejCount = (rejected?.match(/^## .+ — rejected/gm) ?? []).length
  const hasData = decisions && decCount > 0

  const hasDecisions = existsSync(join(loreDir, 'decisions.md'))
  const hasRejected  = existsSync(join(loreDir, 'rejected.md'))
  const hasEvolution = existsSync(join(loreDir, 'evolution.md'))

  const eraLines = evolution ? evolution.split('\n').filter(l => l.startsWith('## Era:')) : []
  const evolutionSummary = eraLines.length
    ? eraLines.slice(0, 5).map(l => l.replace('## Era: ', '')).join('\n') +
      (eraLines.length > 5 ? `\n+${eraLines.length - 5} more` : '')
    : null

  const body = `
    <div class="app-shell">
      <!-- Desktop sidebar -->
      <aside class="side-nav">
        <div class="side-nav-logo">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect width="20" height="20" rx="2" fill="#81da8c"/><path d="M4 10h12M10 4v12" stroke="#003913" stroke-width="2" stroke-linecap="round"/></svg>
        </div>
        <nav class="side-nav-links">
          <a href="/" class="side-link active" title="Overview"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></a>
          ${hasDecisions ? `<a href="/file/decisions.md" class="side-link" title="Decision Log"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 12h6M9 8h6M9 16h4M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z"/></svg></a>` : ''}
          ${hasRejected ? `<a href="/file/rejected.md" class="side-link" title="Rejected Ideas"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M6.34 6.34l11.32 11.32"/></svg></a>` : ''}
          <a href="/graph" class="side-link" title="Module Graph"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v4M9.5 17.5L7 15M14.5 17.5L17 15M10 11l-3 4M14 11l3 4"/></svg></a>
          <a href="/evolution-timeline" class="side-link" title="Evolution Timeline"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 6h18M3 12h14M3 18h10"/></svg></a>
        </nav>
      </aside>

      <!-- Main -->
      <div class="main-area">
        <!-- Top bar -->
        <header class="top-bar">
          <div class="top-bar-brand">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect width="16" height="16" rx="1.5" fill="#81da8c"/><path d="M3 8h10M8 3v10" stroke="#003913" stroke-width="1.5" stroke-linecap="round"/></svg>
            <span class="top-bar-title">CHRONICLE</span>
          </div>
          <div class="top-bar-status">
            <span class="status-dot"></span>
            <span class="top-bar-meta">SYSTEM LOG V2.0</span>
          </div>
          <div class="search-wrap">
            <input id="q" type="text" placeholder="Search .lore/..." autocomplete="off" oninput="doSearch(this.value)" />
          </div>
        </header>

        <div id="search-overlay" class="search-overlay" style="display:none">
          <div id="search-results"></div>
        </div>

        <!-- Content -->
        <main class="main-content">
          <!-- Hero -->
          <section class="hero-section">
            <div class="hero-label">system_log_v2.0</div>
            <h1 class="hero-title">${projectName}</h1>
            <p class="hero-sub">Architectural memory captured from git history. All decisions generated locally.</p>
          </section>

          <!-- Stats row -->
          <div class="stats-row">
            <div class="stat-tile">
              <div class="stat-n">${decCount}</div>
              <div class="stat-l">Decisions</div>
            </div>
            <div class="stat-tile">
              <div class="stat-n">${rejCount}</div>
              <div class="stat-l">Rejected</div>
            </div>
            <div class="stat-tile">
              <div class="stat-n">${adrs.length}</div>
              <div class="stat-l">Deep ADRs</div>
            </div>
            <div class="stat-tile stat-action" onclick="location='/graph'">
              <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#81da8c" stroke-width="1.5"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M10 11l-3 4M14 11l3 4"/></svg></div>
              <div class="stat-l">Graph</div>
            </div>
            <div class="stat-tile stat-action" onclick="location='/evolution-timeline'">
              <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#adc6ff" stroke-width="1.5"><path d="M3 6h18M3 12h14M3 18h10"/></svg></div>
              <div class="stat-l">Timeline</div>
            </div>
          </div>

          ${!hasData ? `
          <div class="empty-state">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" opacity=".25"><rect width="40" height="40" rx="4" fill="#81da8c"/><path d="M8 20h24M20 8v24" stroke="#003913" stroke-width="2.5" stroke-linecap="round"/></svg>
            <div class="empty-title">Knowledge base not yet populated</div>
            <div class="empty-body">Run <code>chronicle init</code> to analyze git history and fill the knowledge base.</div>
          </div>` : ''}

          ${index ? `
          <section class="content-section">
            <div class="section-label">project index</div>
            <div class="md-content">${mdToHtml(index)}</div>
          </section>` : ''}

          ${evolutionSummary ? `
          <section class="content-section">
            <div class="section-label">evolution phases</div>
            <div class="era-list">
              ${eraLines.slice(0, 5).map((l, i) => `
              <div class="era-row">
                <span class="era-num">${String(i + 1).padStart(2, '0')}</span>
                <span class="era-text">${l.replace('## Era: ', '')}</span>
              </div>`).join('')}
              ${eraLines.length > 5 ? `<div class="era-more">+${eraLines.length - 5} more phases</div>` : ''}
            </div>
            <a href="/evolution-timeline" class="section-link">View full timeline →</a>
          </section>` : ''}

          ${hasData ? `
          <section class="content-section">
            <div class="section-label">recent decisions</div>
            <div class="md-content">${mdToHtml(decisions)}</div>
          </section>` : ''}

          ${adrs.length ? `
          <section class="content-section">
            <div class="section-label">deep ADRs (${adrs.length})</div>
            <div class="adr-list">
              ${adrs.map(a => `<a href="/file/${encodeURIComponent(a.file)}" class="adr-item">${a.name}</a>`).join('')}
            </div>
          </section>` : ''}
        </main>
      </div>
    </div>

    <script>
      let searchTimer;
      function doSearch(q) {
        clearTimeout(searchTimer);
        const overlay = document.getElementById('search-overlay');
        const el = document.getElementById('search-results');
        if (!q.trim()) { overlay.style.display = 'none'; return; }
        overlay.style.display = 'block';
        searchTimer = setTimeout(async () => {
          const r = await fetch('/api/search?q=' + encodeURIComponent(q)).then(r => r.json());
          if (!r.length) { el.innerHTML = '<div class="no-results">No results found</div>'; return; }
          el.innerHTML = r.map(x =>
            '<div class="search-result"><span class="search-file">' + x.file + ':' + x.line + '</span><span class="search-text">' +
            x.text.replace(new RegExp(q, 'gi'), m => '<mark>' + m + '</mark>') + '</span></div>'
          ).join('');
        }, 200);
      }
      document.addEventListener('click', e => {
        if (!e.target.closest('#search-overlay') && !e.target.closest('#q')) {
          document.getElementById('search-overlay').style.display = 'none';
        }
      });
    </script>
  `
  return html(`Chronicle — ${projectName}`, body)
}

function renderFile(rel: string, content: string): string {
  const title = rel.replace('decisions/', '').replace('.md', '').replace(/-/g, ' ')
  const body = `
    <div class="app-shell">
      <aside class="side-nav">
        <div class="side-nav-logo">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect width="20" height="20" rx="2" fill="#81da8c"/><path d="M4 10h12M10 4v12" stroke="#003913" stroke-width="2" stroke-linecap="round"/></svg>
        </div>
        <nav class="side-nav-links">
          <a href="/" class="side-link" title="Overview"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></a>
          <a href="/graph" class="side-link" title="Module Graph"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M10 11l-3 4M14 11l3 4"/></svg></a>
          <a href="/evolution-timeline" class="side-link" title="Timeline"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 6h18M3 12h14M3 18h10"/></svg></a>
        </nav>
      </aside>
      <div class="main-area">
        <header class="top-bar">
          <div class="top-bar-brand">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect width="16" height="16" rx="1.5" fill="#81da8c"/><path d="M3 8h10M8 3v10" stroke="#003913" stroke-width="1.5" stroke-linecap="round"/></svg>
            <span class="top-bar-title">CHRONICLE</span>
          </div>
          <a href="/" class="back-link">← Overview</a>
        </header>
        <main class="main-content">
          <section class="hero-section">
            <div class="hero-label">knowledge base</div>
            <h1 class="hero-title">${title}</h1>
          </section>
          <section class="content-section">
            <div class="md-content">${mdToHtml(content)}</div>
          </section>
        </main>
      </div>
    </div>
  `
  return html(title, body)
}

function html(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }

  /* Design tokens */
  :root {
    --bg:           #0f1419;
    --surf-low:     #171c22;
    --surf:         #1b2026;
    --surf-high:    #252a30;
    --surf-highest: #30353b;
    --surf-lowest:  #0a0f14;
    --primary:      #81da8c;
    --primary-cont: #2f8743;
    --secondary:    #adc6ff;
    --tertiary:     #ffba38;
    --on-surface:   #dee3eb;
    --on-variant:   #bfcabb;
    --outline:      #3f493e;
  }

  body {
    font-family: 'Inter', -apple-system, sans-serif;
    background: var(--bg);
    color: var(--on-surface);
    min-height: 100vh;
    font-size: 14px;
    line-height: 1.6;
  }

  /* Layout */
  .app-shell { display: flex; min-height: 100vh }

  .side-nav {
    width: 64px; min-width: 64px; background: var(--surf-low);
    display: flex; flex-direction: column; align-items: center;
    padding: 20px 0; gap: 8px; position: fixed; top: 0; left: 0;
    height: 100vh; z-index: 50;
  }
  .side-nav-logo { padding: 8px; margin-bottom: 8px }
  .side-nav-links { display: flex; flex-direction: column; gap: 4px; width: 100%; padding: 0 8px }
  .side-link {
    display: flex; align-items: center; justify-content: center;
    padding: 10px; border-radius: 4px; color: var(--on-variant);
    text-decoration: none; transition: background .15s, color .15s;
  }
  .side-link:hover { background: var(--surf-highest); color: var(--primary) }
  .side-link.active { background: var(--surf-highest); color: var(--primary) }

  .main-area { flex: 1; margin-left: 64px; display: flex; flex-direction: column }

  .top-bar {
    position: sticky; top: 0; z-index: 40; background: var(--bg);
    border-bottom: 1px solid var(--outline); padding: 12px 24px;
    display: flex; align-items: center; gap: 16px;
    box-shadow: 0 4px 20px rgba(47,135,67,.08);
  }
  .top-bar-brand { display: flex; align-items: center; gap: 10px; flex-shrink: 0 }
  .top-bar-title {
    font-family: 'Space Grotesk', sans-serif; font-weight: 700;
    font-size: 13px; letter-spacing: .12em; color: var(--primary); text-transform: uppercase;
  }
  .top-bar-status { display: flex; align-items: center; gap: 6px; flex-shrink: 0 }
  .status-dot {
    width: 7px; height: 7px; border-radius: 50%; background: var(--primary);
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  .top-bar-meta {
    font-family: ui-monospace, monospace; font-size: 10px;
    letter-spacing: .1em; color: var(--on-variant); text-transform: uppercase;
  }
  .search-wrap { flex: 1; max-width: 360px; margin-left: auto }
  #q {
    width: 100%; background: var(--surf-high); border: none;
    border-bottom: 2px solid transparent; color: var(--on-surface);
    padding: 7px 12px; border-radius: 4px; font-size: 13px; outline: none;
    font-family: ui-monospace, monospace; transition: border-color .15s;
  }
  #q:focus { border-bottom-color: var(--primary) }
  #q::placeholder { color: var(--on-variant); opacity: .5 }
  .back-link { font-size: 12px; color: var(--on-variant); text-decoration: none; margin-left: auto }
  .back-link:hover { color: var(--primary) }

  .search-overlay {
    position: fixed; top: 57px; left: 64px; right: 0; z-index: 100;
    background: var(--surf-low); border-bottom: 1px solid var(--outline);
    max-height: 60vh; overflow-y: auto; padding: 12px 24px;
  }
  .search-result { padding: 8px 0; border-bottom: 1px solid var(--outline) }
  .search-result:last-child { border-bottom: none }
  .search-file { font-family: ui-monospace, monospace; font-size: 11px; color: var(--on-variant); margin-right: 10px }
  .search-text { font-size: 13px }
  .search-result mark { background: #2d4a22; color: #ffba38; border-radius: 2px; padding: 0 2px }
  .no-results { color: var(--on-variant); font-size: 13px; padding: 8px 0 }

  .main-content { padding: 32px 24px 64px; max-width: 920px }

  /* Hero */
  .hero-section { margin-bottom: 32px }
  .hero-label {
    font-family: ui-monospace, monospace; font-size: 11px; font-weight: 700;
    color: var(--primary); letter-spacing: .12em; text-transform: uppercase; margin-bottom: 8px;
  }
  .hero-title {
    font-family: 'Space Grotesk', sans-serif; font-size: 36px; font-weight: 700;
    letter-spacing: -.02em; color: var(--on-surface); margin-bottom: 8px; line-height: 1.15;
  }
  .hero-sub { font-size: 14px; color: var(--on-variant); max-width: 560px }

  /* Stats */
  .stats-row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 32px }
  .stat-tile {
    background: var(--surf-low); border-radius: 4px; padding: 16px 20px;
    min-width: 90px; text-align: center; flex: 1;
  }
  .stat-tile.stat-action { cursor: pointer; transition: background .15s }
  .stat-tile.stat-action:hover { background: var(--surf) }
  .stat-n { font-family: 'Space Grotesk', sans-serif; font-size: 28px; font-weight: 700; color: var(--on-surface); line-height: 1 }
  .stat-icon { line-height: 1; margin-bottom: 2px }
  .stat-l { font-family: ui-monospace, monospace; font-size: 10px; color: var(--on-variant); text-transform: uppercase; letter-spacing: .08em; margin-top: 4px }

  /* Empty state */
  .empty-state {
    background: var(--surf-low); border-radius: 4px; border: 1px dashed var(--outline);
    padding: 40px; text-align: center; margin-bottom: 32px;
    display: flex; flex-direction: column; align-items: center; gap: 12px;
  }
  .empty-title { font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 600; color: var(--on-variant) }
  .empty-body { font-size: 13px; color: #6e7681 }
  .empty-body code { font-family: ui-monospace, monospace; background: var(--surf-lowest); padding: 2px 6px; border-radius: 3px; color: #ffba38 }

  /* Sections */
  .content-section { margin-bottom: 36px }
  .section-label {
    font-family: ui-monospace, monospace; font-size: 10px; font-weight: 700;
    color: var(--on-variant); letter-spacing: .12em; text-transform: uppercase;
    margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--outline);
  }
  .section-link { font-size: 12px; color: var(--secondary); text-decoration: none; margin-top: 10px; display: inline-block }
  .section-link:hover { color: var(--primary) }

  /* Era list */
  .era-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px }
  .era-row { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: var(--surf-low); border-left: 2px solid var(--primary); border-radius: 0 4px 4px 0 }
  .era-num { font-family: ui-monospace, monospace; font-size: 12px; color: var(--outline); min-width: 24px }
  .era-text { font-size: 13px; color: var(--on-variant) }
  .era-more { font-family: ui-monospace, monospace; font-size: 11px; color: var(--on-variant); padding: 6px 12px; opacity: .6 }

  /* ADR list */
  .adr-list { display: flex; flex-direction: column; gap: 4px }
  .adr-item {
    padding: 8px 12px; background: var(--surf-low); border-radius: 4px;
    color: var(--secondary); text-decoration: none; font-size: 13px;
    border-left: 2px solid var(--secondary); transition: background .15s;
  }
  .adr-item:hover { background: var(--surf) }

  /* Markdown content */
  .md-content h1 { font-family: 'Space Grotesk', sans-serif; font-size: 22px; font-weight: 700; color: var(--on-surface); margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid var(--outline) }
  .md-content h2 { font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 600; color: var(--on-surface); margin: 20px 0 8px }
  .md-content h3 { font-size: 14px; font-weight: 600; color: var(--on-surface); margin: 14px 0 6px }
  .md-content p { color: var(--on-variant); margin-bottom: 10px }
  .md-content a { color: var(--secondary); text-decoration: none }
  .md-content a:hover { color: var(--primary) }
  .md-content code { font-family: ui-monospace, monospace; background: var(--surf-lowest); padding: 2px 5px; border-radius: 3px; font-size: 12px; color: var(--primary) }
  .md-content pre { background: var(--surf-lowest); border-radius: 4px; padding: 14px; overflow-x: auto; margin-bottom: 14px }
  .md-content pre code { background: none; padding: 0; color: var(--on-variant) }
  .md-content ul, .md-content ol { padding-left: 20px; margin-bottom: 10px }
  .md-content li { color: var(--on-variant); margin-bottom: 4px }
  .md-content strong { color: var(--on-surface) }
  .md-content em { color: var(--secondary) }
  .md-content hr { border: none; border-top: 1px solid var(--outline); margin: 18px 0 }
  .md-content table { border-collapse: collapse; width: 100%; margin-bottom: 14px; font-size: 13px }
  .md-content th { background: var(--surf-lowest); color: var(--on-variant); font-family: ui-monospace, monospace; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; padding: 8px 10px; text-align: left }
  .md-content td { padding: 7px 10px; color: var(--on-variant); border-top: 1px solid var(--outline) }
  .md-content tr:hover td { background: var(--surf-low) }

  /* Mobile nav */
  @media (max-width: 768px) {
    .side-nav { display: none }
    .main-area { margin-left: 0 }
    .search-overlay { left: 0 }
    .main-content { padding: 24px 16px 80px }
    .hero-title { font-size: 26px }
    .stats-row { gap: 8px }
    .stat-tile { min-width: 70px; padding: 12px }
    .stat-n { font-size: 22px }
  }
  @media (max-width: 768px) {
    .mob-nav {
      display: flex; position: fixed; bottom: 0; left: 0; right: 0; z-index: 60;
      background: rgba(23,28,34,.9); backdrop-filter: blur(12px);
      border-top: 1px solid var(--outline); padding: 10px 0 20px;
    }
  }
  .mob-nav { display: none }
  .mob-nav a { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; color: var(--on-variant); text-decoration: none; font-family: ui-monospace, monospace; font-size: 9px; text-transform: uppercase; letter-spacing: .06em }
  .mob-nav a.active { color: var(--primary) }
  .mob-nav svg { width: 20px; height: 20px }
</style>
</head>
<body>
${body}
<nav class="mob-nav">
  <a href="/" class="active"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>Dash</a>
  <a href="/graph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M10 11l-3 4M14 11l3 4"/></svg>Graph</a>
  <a href="/evolution-timeline"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 6h18M3 12h14M3 18h10"/></svg>Timeline</a>
</nav>
</body></html>`
}

/** Minimal markdown → HTML (handles tables, headings, code, bold, italic, links) */
function mdToHtml(md: string): string {
  if (!md) return '<p><em>No content yet.</em></p>'

  return md
    // Fenced code blocks
    .replace(/```[\s\S]*?```/g, m => `<pre><code>${escHtml(m.slice(3, -3).replace(/^\w+\n/, ''))}</code></pre>`)
    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // HR
    .replace(/^---$/gm, '<hr>')
    // Tables — convert | rows to <table>
    .replace(/((?:\|.+\|\n?)+)/g, (block) => {
      const rows = block.trim().split('\n').filter(r => !/^\|[-:| ]+\|$/.test(r))
      if (rows.length === 0) return block
      const [head, ...body] = rows
      const th = head.split('|').filter(Boolean).map(c => `<th>${c.trim()}</th>`).join('')
      const td = body.map(r => '<tr>' + r.split('|').filter(Boolean).map(c => `<td>${renderInline(c.trim())}</td>`).join('') + '</tr>').join('')
      return `<table><thead><tr>${th}</tr></thead><tbody>${td}</tbody></table>`
    })
    // Lists
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    // Inline
    .split('\n').map(line => {
      if (/^<(h[1-6]|ul|ol|li|pre|table|hr)/.test(line)) return line
      return line.trim() ? `<p>${renderInline(line)}</p>` : ''
    }).join('\n')
}

function renderInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      // Rewrite relative .md links to /file/ so the server handles them
      const resolved = href.startsWith('http') ? href : `/file/${href}`
      return `<a href="${resolved}">${label}</a>`
    })
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function searchLore(loreDir: string, query: string, limit: number) {
  if (!query.trim()) return []
  const pattern = new RegExp(query, 'gi')
  const results: Array<{ file: string; line: number; text: string }> = []

  function walk(dir: string) {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (results.length >= limit) return
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!entry.name.endsWith('.md')) continue
      const lines = readFileSync(full, 'utf8').split('\n')
      for (let i = 0; i < lines.length && results.length < limit; i++) {
        pattern.lastIndex = 0
        if (pattern.test(lines[i])) {
          results.push({ file: full.replace(loreDir + '/', ''), line: i + 1, text: lines[i].trim() })
        }
      }
    }
  }

  walk(loreDir)
  return results
}
