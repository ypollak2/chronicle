import chalk from 'chalk'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, extname } from 'path'
import { findLoreRoot, lorePath, readStore } from '@chronicle/core'
import { buildGraphData } from '../graph.js'
import { renderGraphHtml } from './graph.js'

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

  // Parse quick stats from decisions
  const decCount = (decisions?.match(/^\|/gm) ?? []).length - 2  // subtract header rows
  const rejCount = (rejected?.match(/^## .+ — rejected/gm) ?? []).length

  return html(`Chronicle — ${projectName}`, `
    <div class="sidebar">
      <h2>📚 ${projectName}</h2>
      <nav>
        <a href="/" class="active">Overview</a>
        <a href="/file/decisions.md">Decision Log</a>
        <a href="/file/rejected.md">Rejected Ideas</a>
        <a href="/file/evolution.md">System Evolution</a>
        <a href="/graph" style="color:#3fb950">◆ Graph View</a>
        ${adrs.length ? `<hr><small>Deep ADRs (${adrs.length})</small>` : ''}
        ${adrs.map(a => `<a href="/file/${encodeURIComponent(a.file)}">${a.name}</a>`).join('\n')}
      </nav>
    </div>
    <div class="main">
      <div class="search-bar">
        <input id="q" type="text" placeholder="Search .lore/…" oninput="search(this.value)" />
        <div id="results"></div>
      </div>
      <div class="content">
        <div class="overview">
          <div class="overview-stats">
            <div class="stat-card"><div class="stat-num">${Math.max(0, decCount)}</div><div class="stat-label">Decisions</div></div>
            <div class="stat-card"><div class="stat-num">${rejCount}</div><div class="stat-label">Rejected Ideas</div></div>
            <div class="stat-card"><div class="stat-num">${adrs.length}</div><div class="stat-label">Deep ADRs</div></div>
            <div class="stat-card stat-card-link" onclick="location='/graph'"><div class="stat-num">◆</div><div class="stat-label">Graph View</div></div>
          </div>
          ${index ? `<div class="overview-section"><h2>Project Index</h2>${mdToHtml(index)}</div>` : ''}
          ${evolution ? `<div class="overview-section"><h2>Evolution</h2>${mdToHtml(evolution.split('\n').slice(0, 30).join('\n'))}${evolution.split('\n').length > 30 ? `<p><a href="/file/evolution.md">Read full evolution →</a></p>` : ''}</div>` : ''}
          <div class="overview-section"><h2>Recent Decisions</h2>${mdToHtml(decisions)}</div>
        </div>
      </div>
    </div>
    <script>
      let timer;
      function search(q) {
        clearTimeout(timer);
        if (!q.trim()) { document.getElementById('results').innerHTML = ''; return; }
        timer = setTimeout(async () => {
          const r = await fetch('/api/search?q=' + encodeURIComponent(q)).then(r => r.json());
          const el = document.getElementById('results');
          if (!r.length) { el.innerHTML = '<div class="no-results">No results</div>'; return; }
          el.innerHTML = r.map(x =>
            '<div class="result"><span class="file">' + x.file + ':' + x.line + '</span> ' +
            x.text.replace(new RegExp(q, 'gi'), m => '<mark>' + m + '</mark>') + '</div>'
          ).join('');
        }, 200);
      }
    </script>
  `)
}

function renderFile(rel: string, content: string): string {
  return html(rel, `
    <div class="sidebar">
      <h2>📚 Chronicle</h2>
      <nav>
        <a href="/">← Overview</a>
        <a href="/file/decisions.md">Decision Log</a>
        <a href="/file/rejected.md">Rejected Ideas</a>
        <a href="/file/evolution.md">System Evolution</a>
      </nav>
    </div>
    <div class="main"><div class="content">${mdToHtml(content)}</div></div>
  `)
}

function html(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
  body { font: 15px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #0d1117; color: #c9d1d9; display: flex; height: 100vh; overflow: hidden }
  .sidebar { width: 220px; min-width: 220px; background: #161b22; border-right: 1px solid #30363d;
             padding: 20px 12px; overflow-y: auto; flex-shrink: 0 }
  .sidebar h2 { font-size: 13px; color: #8b949e; text-transform: uppercase; letter-spacing: .08em;
                margin-bottom: 12px }
  .sidebar nav { display: flex; flex-direction: column; gap: 2px }
  .sidebar nav a { color: #58a6ff; text-decoration: none; font-size: 13px;
                    padding: 4px 8px; border-radius: 4px; white-space: nowrap; overflow: hidden;
                    text-overflow: ellipsis }
  .sidebar nav a:hover { background: #21262d }
  .sidebar hr { border: none; border-top: 1px solid #30363d; margin: 10px 0 }
  .sidebar small { color: #8b949e; font-size: 11px; padding: 0 8px }
  .main { flex: 1; overflow-y: auto; padding: 0 }
  .search-bar { position: sticky; top: 0; background: #0d1117; padding: 16px 24px;
                border-bottom: 1px solid #30363d; z-index: 10 }
  #q { width: 100%; background: #161b22; border: 1px solid #30363d; color: #c9d1d9;
       padding: 8px 12px; border-radius: 6px; font-size: 14px; outline: none }
  #q:focus { border-color: #58a6ff }
  #results { margin-top: 8px }
  .result { font-size: 13px; padding: 4px 0; border-bottom: 1px solid #21262d }
  .result .file { color: #8b949e; margin-right: 8px; font-family: monospace }
  .result mark { background: #2d4a22; color: #f0c05a; border-radius: 2px; padding: 0 2px }
  .no-results { color: #8b949e; font-size: 13px }
  .content { padding: 24px; max-width: 860px }
  .content h1 { font-size: 22px; border-bottom: 1px solid #30363d; padding-bottom: 8px; margin-bottom: 16px; color: #e6edf3 }
  .content h2 { font-size: 17px; margin: 24px 0 8px; color: #e6edf3 }
  .content h3 { font-size: 14px; margin: 16px 0 6px; color: #e6edf3 }
  .content p { margin-bottom: 12px; color: #c9d1d9 }
  .content table { border-collapse: collapse; width: 100%; margin-bottom: 16px; font-size: 13px }
  .content th, .content td { border: 1px solid #30363d; padding: 6px 10px; text-align: left }
  .content th { background: #161b22; color: #8b949e; font-weight: 600 }
  .content tr:hover td { background: #161b22 }
  .content code { background: #161b22; padding: 2px 6px; border-radius: 4px; font-size: 12px;
                  font-family: 'SF Mono', Consolas, monospace; color: #f85149 }
  .content pre { background: #161b22; border: 1px solid #30363d; border-radius: 6px;
                 padding: 14px; overflow-x: auto; margin-bottom: 16px }
  .content pre code { background: none; padding: 0; color: #c9d1d9 }
  .content a { color: #58a6ff; text-decoration: none }
  .content a:hover { text-decoration: underline }
  .content hr { border: none; border-top: 1px solid #30363d; margin: 20px 0 }
  .content ul, .content ol { padding-left: 20px; margin-bottom: 12px }
  .content li { margin-bottom: 4px }
  strong { color: #e6edf3 }
  em { color: #a5d6ff }
  .sidebar nav a.active { background: #21262d; color: #e6edf3 }
  .overview-stats { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap }
  .stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px;
               padding: 16px 20px; min-width: 100px; text-align: center }
  .stat-card-link { cursor: pointer; transition: border-color .15s }
  .stat-card-link:hover { border-color: #58a6ff }
  .stat-num { font-size: 28px; font-weight: 700; color: #e6edf3; line-height: 1 }
  .stat-label { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: .06em; margin-top: 4px }
  .overview-section { margin-bottom: 32px }
  .overview-section h2 { font-size: 15px; color: #8b949e; text-transform: uppercase;
                         letter-spacing: .06em; margin-bottom: 12px; padding-bottom: 6px;
                         border-bottom: 1px solid #30363d }
</style>
</head><body>${body}</body></html>`
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
