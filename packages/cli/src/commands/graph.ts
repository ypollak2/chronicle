import chalk from 'chalk'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { findLoreRoot } from '@chronicle/core'
import { buildGraphData, type GraphData } from '../graph.js'

export async function cmdGraph(opts: { output?: string; open?: boolean }) {
  const root = findLoreRoot()
  if (!root) {
    console.error(chalk.red('✗  No .lore/ found. Run `chronicle init` first.'))
    process.exit(1)
  }

  const data = buildGraphData(root)
  if (data.nodes.length === 0) {
    console.error(chalk.yellow('⚠  No decisions found in .lore/ — run `chronicle init` first.'))
    process.exit(1)
  }

  const outFile = opts.output ?? 'chronicle-graph.html'
  const html = renderGraphHtml(data, root.split('/').pop() ?? 'project')
  writeFileSync(outFile, html, 'utf8')

  console.log(chalk.bold(`\n◆ Chronicle Graph\n`))
  console.log(`  ${chalk.green('✓')} ${outFile}  (${data.stats.modules} modules, ${data.stats.decisions} decisions)\n`)

  if (opts.open !== false) {
    try {
      const { execSync } = require('child_process')
      const open = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
      execSync(`${open} ${join(process.cwd(), outFile)}`, { stdio: 'ignore' })
    } catch { /* no browser */ }
  }
}

export function renderGraphHtml(data: GraphData, projectName: string): string {
  const json = JSON.stringify(data)
  const riskColor: Record<string, string> = { high: '#f85149', medium: '#d29922', low: '#3fb950', none: '#8b949e' }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chronicle Graph — ${projectName}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<script src="https://d3js.org/d3.v7.min.js"></script>
<style>
  :root {
    --bg: #0f1419; --surface: #171c22; --surface-hi: #1b2026; --surface-top: #252a30;
    --border: rgba(255,255,255,0.06); --primary: #81da8c; --primary-dim: #2f8743;
    --text: #bfcabb; --text-hi: #e8ece7; --text-lo: #6b7280; --mono: ui-monospace, 'Cascadia Code', monospace;
    --red: #f85149; --amber: #d29922; --green: #3fb950;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
  body { font: 14px/1.5 'Inter', sans-serif; background: var(--bg); color: var(--text);
         height: 100vh; display: flex; flex-direction: column; overflow: hidden }
  .top-bar { background: var(--surface); padding: 0 24px; height: 52px; display: flex;
              align-items: center; gap: 16px; flex-shrink: 0; border-bottom: 1px solid var(--border) }
  .brand { font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 700;
           color: var(--primary); letter-spacing: -0.02em; display: flex; align-items: center; gap: 8px }
  .top-stats { font-size: 11px; color: var(--text-lo); margin-left: auto; display: flex; gap: 20px;
               font-family: var(--mono) }
  .top-stats b { color: var(--text-hi); font-weight: 600 }
  .back-link { font-size: 12px; color: var(--text-lo); text-decoration: none; font-family: var(--mono);
               padding: 4px 10px; border-radius: 4px; background: var(--surface-hi);
               transition: color .15s, background .15s }
  .back-link:hover { color: var(--primary); background: var(--surface-top) }
  .tabs { display: flex; gap: 0; background: var(--surface); flex-shrink: 0;
          padding: 0 24px; border-bottom: 1px solid var(--border) }
  .tab { padding: 10px 18px; font-size: 12px; font-family: var(--mono); cursor: pointer;
         border: none; background: none; color: var(--text-lo);
         border-bottom: 2px solid transparent; transition: color .15s; letter-spacing: .04em }
  .tab:hover { color: var(--text) }
  .tab.active { color: var(--primary); border-bottom-color: var(--primary) }
  .panel { display: none; flex: 1; overflow: hidden }
  .panel.active { display: flex; flex-direction: column }
  #topology-panel { position: relative }
  #graph-svg { width: 100%; height: 100%; cursor: grab }
  #graph-svg:active { cursor: grabbing }
  .node circle { stroke-width: 1.5; transition: r .2s }
  .node text { pointer-events: none; font-size: 11px; fill: var(--text-hi);
               font-family: var(--mono); text-shadow: 0 1px 4px var(--bg) }
  .link { stroke: var(--surface-top); stroke-opacity: .9 }
  #empty-state { display: none; flex: 1; flex-direction: column; align-items: center;
                 justify-content: center; color: var(--text-lo); text-align: center; gap: 14px }
  .empty-icon { font-size: 44px; opacity: .2; color: var(--primary) }
  .empty-title { font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 600; color: var(--text) }
  .empty-body { font-size: 13px; color: var(--text-lo) }
  .empty-body code { font-family: var(--mono); background: var(--surface); padding: 2px 8px;
                     border-radius: 4px; color: #f0883e }
  .empty-link { font-size: 12px; color: var(--primary); text-decoration: none; font-family: var(--mono) }
  .empty-link:hover { text-decoration: underline }
  .tooltip { position: absolute; background: rgba(23,28,34,0.92); backdrop-filter: blur(12px);
              border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px;
              font-size: 12px; pointer-events: none; max-width: 280px; line-height: 1.6;
              display: none; z-index: 10 }
  .tooltip strong { color: var(--text-hi); display: block; margin-bottom: 4px;
                    font-family: 'Space Grotesk', sans-serif }
  .tooltip .risk-high { color: var(--red) } .tooltip .risk-medium { color: var(--amber) }
  .tooltip .risk-low  { color: var(--green) } .tooltip .risk-none { color: var(--text-lo) }
  .legend { position: absolute; bottom: 16px; left: 16px; background: rgba(23,28,34,0.88);
             backdrop-filter: blur(8px); border: 1px solid var(--border); border-radius: 6px;
             padding: 12px 16px; font-size: 12px }
  .legend-title { color: var(--text-lo); margin-bottom: 8px; font-size: 10px; font-family: var(--mono);
                  text-transform: uppercase; letter-spacing: .1em }
  .legend-item { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; color: var(--text) }
  .legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0 }
  .legend-note { margin-top: 10px; color: var(--text-lo); font-size: 10px; font-family: var(--mono) }
  #hotspots-panel { overflow-y: auto; padding: 28px }
  .hotspots-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; max-width: 1100px }
  .card { background: var(--surface); border-radius: 8px; padding: 18px }
  .card h3 { font-size: 10px; font-family: var(--mono); color: var(--text-lo);
             text-transform: uppercase; letter-spacing: .1em; margin-bottom: 14px }
  .hs-row { display: flex; align-items: center; gap: 10px; padding: 6px 0;
            border-bottom: 1px solid rgba(255,255,255,0.04) }
  .hs-row:last-child { border-bottom: none }
  .hs-name { flex: 1; font-size: 12px; color: var(--text); font-family: var(--mono) }
  .hs-bar-wrap { width: 90px; background: var(--surface-hi); border-radius: 2px; height: 4px; overflow: hidden }
  .hs-bar { height: 4px; border-radius: 2px; transition: width .4s }
  .hs-count { font-size: 11px; color: var(--text-lo); min-width: 22px; text-align: right; font-family: var(--mono) }
  .risk-badge { font-size: 10px; padding: 1px 6px; border-radius: 3px; font-weight: 600; font-family: var(--mono) }
  .risk-high-bg { background: rgba(248,81,73,.15); color: var(--red) }
  .risk-medium-bg { background: rgba(210,153,34,.15); color: var(--amber) }
  .risk-low-bg  { background: rgba(63,185,80,.15); color: var(--green) }
  .risk-none-bg  { background: var(--surface-hi); color: var(--text-lo) }
</style>
</head>
<body>
<div class="top-bar">
  <div class="brand">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M10 11l-3 4M14 11l3 4"/></svg>
    MODULE GRAPH
  </div>
  <span style="color:var(--text-lo);font-size:13px;font-family:var(--mono)">${projectName}</span>
  <div class="top-stats">
    <div><b id="s-mods">0</b> modules</div>
    <div><b id="s-dec">0</b> decisions</div>
    <div><b id="s-rej">0</b> rejections</div>
    <div style="color:var(--text-lo);font-size:10px">generated <span id="s-gen"></span></div>
  </div>
  <a href="/" class="back-link">← Overview</a>
</div>
<div class="tabs">
  <button class="tab active" onclick="showTab('topology')">Topology</button>
  <button class="tab" onclick="showTab('hotspots')">Hotspots</button>
</div>
<div id="topology-panel" class="panel active">
  <div id="empty-state">
    <div class="empty-icon">◆</div>
    <div class="empty-title">No module graph yet</div>
    <div class="empty-body">Run <code>chronicle init</code> to analyze your git history</div>
    <a href="/evolution-timeline" class="empty-link">Then view the evolution timeline →</a>
  </div>
  <svg id="graph-svg"></svg>
  <div class="tooltip" id="tooltip"></div>
  <div class="legend">
    <div class="legend-title">Max Risk</div>
    <div class="legend-item"><div class="legend-dot" style="background:var(--red)"></div> High</div>
    <div class="legend-item"><div class="legend-dot" style="background:var(--amber)"></div> Medium</div>
    <div class="legend-item"><div class="legend-dot" style="background:var(--green)"></div> Low</div>
    <div class="legend-item"><div class="legend-dot" style="background:var(--text-lo)"></div> None</div>
    <div class="legend-note">Node size = decision count</div>
  </div>
</div>
<div id="hotspots-panel" class="panel">
  <div class="hotspots-grid" id="hotspots-content"></div>
</div>

<script>
const DATA = ${json};
const RISK_COLOR = { high:'#f85149', medium:'#d29922', low:'#3fb950', none:'#555e68' };

// ── Header stats ───────────────────────────────────────────────────────────────
document.getElementById('s-mods').textContent = DATA.stats.modules;
document.getElementById('s-dec').textContent  = DATA.stats.decisions;
document.getElementById('s-rej').textContent  = DATA.stats.rejections;
document.getElementById('s-gen').textContent  = DATA.generated.slice(0,10);

// Show empty state when no data
if (DATA.nodes.length === 0) {
  document.getElementById('empty-state').style.display = 'flex';
  document.getElementById('graph-svg').style.display = 'none';
  document.querySelector('.legend').style.display = 'none';
}

// ── Tab switching ──────────────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', ['topology','hotspots'][i] === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById(name + '-panel').classList.add('active');
  if (name === 'topology') requestAnimationFrame(drawGraph);
  if (name === 'hotspots') drawHotspots();
}

// ── D3 Force Graph ─────────────────────────────────────────────────────────────
let graphDrawn = false;
function drawGraph() {
  if (graphDrawn) return;
  graphDrawn = true;

  const svg = d3.select('#graph-svg');
  const { width, height } = svg.node().getBoundingClientRect();

  const nodes = DATA.nodes.map(d => ({...d}));
  const links = DATA.links.map(d => ({...d}));

  const maxDec = d3.max(nodes, d => d.decisions) || 1;
  const rScale = d3.scaleSqrt().domain([0, maxDec]).range([8, 36]);
  const lScale = d3.scaleLinear().domain([1, d3.max(links, d => d.weight) || 1]).range([1, 6]);

  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(d => 120 + (36 - rScale(d.source.decisions || 0))))
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => rScale(d.decisions) + 12));

  const g = svg.append('g');

  // Zoom
  svg.call(d3.zoom().scaleExtent([0.2, 4]).on('zoom', e => g.attr('transform', e.transform)));

  const link = g.append('g').selectAll('line').data(links).join('line')
    .attr('class', 'link')
    .attr('stroke-width', d => lScale(d.weight));

  const tooltip = document.getElementById('tooltip');

  const node = g.append('g').selectAll('g').data(nodes).join('g')
    .attr('class', 'node')
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end',   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }))
    .on('mouseover', (e, d) => {
      const linked = new Set(links.filter(l => l.source.id === d.id || l.target.id === d.id)
        .flatMap(l => [l.source.id, l.target.id]));
      node.selectAll('circle').attr('opacity', n => linked.has(n.id) ? 1 : 0.25);
      link.attr('opacity', l => l.source.id === d.id || l.target.id === d.id ? 1 : 0.1);
      const dec = d.titles.slice(0,5).map(t => '<li style="color:#c9d1d9">'+t+'</li>').join('');
      const more = d.titles.length > 5 ? '<li style="color:#8b949e">+ ' + (d.titles.length-5) + ' more…</li>' : '';
      tooltip.innerHTML =
        '<strong>' + d.id + '</strong>' +
        '<div>Decisions: <b>' + d.decisions + '</b> &nbsp; Rejections: <b>' + d.rejections + '</b></div>' +
        '<div>Risk: <span class="risk-' + d.maxRisk + '">' + d.maxRisk + '</span></div>' +
        (dec ? '<ul style="margin-top:6px;padding-left:14px;font-size:11px">' + dec + more + '</ul>' : '');
      tooltip.style.display = 'block';
      tooltip.style.left = (e.pageX + 14) + 'px';
      tooltip.style.top  = (e.pageY - 10) + 'px';
    })
    .on('mousemove', e => {
      tooltip.style.left = (e.pageX + 14) + 'px';
      tooltip.style.top  = (e.pageY - 10) + 'px';
    })
    .on('mouseout', () => {
      node.selectAll('circle').attr('opacity', 1);
      link.attr('opacity', 1);
      tooltip.style.display = 'none';
    });

  node.append('circle')
    .attr('r', d => rScale(d.decisions))
    .attr('fill', d => RISK_COLOR[d.maxRisk] + '33')
    .attr('stroke', d => RISK_COLOR[d.maxRisk]);

  node.append('text')
    .attr('dy', d => rScale(d.decisions) + 13)
    .attr('text-anchor', 'middle')
    .text(d => d.id.endsWith('/') ? d.id.slice(0, -1) : d.id);

  sim.on('tick', () => {
    link
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
  });
}

// ── Hotspots ───────────────────────────────────────────────────────────────────
function drawHotspots() {
  const el = document.getElementById('hotspots-content');
  if (el.children.length) return;

  const nodes = [...DATA.nodes];
  const maxDec = Math.max(1, ...nodes.map(n => n.decisions));
  const maxRej = Math.max(1, ...nodes.map(n => n.rejections));

  const byDec = [...nodes].sort((a,b) => b.decisions - a.decisions).slice(0,10);
  const byRej = [...nodes].filter(n => n.rejections > 0).sort((a,b) => b.rejections - a.rejections).slice(0,10);
  const byRisk = [...nodes].filter(n => n.maxRisk !== 'none')
    .sort((a,b) => ({high:3,medium:2,low:1,none:0}[b.maxRisk] - {high:3,medium:2,low:1,none:0}[a.maxRisk])).slice(0,10);
  const mostLinked = [...nodes].map(n => ({
    ...n,
    links: DATA.links.filter(l => l.source === n.id || l.target === n.id).length
  })).sort((a,b) => b.links - a.links).slice(0,10);

  function card(title, rows, barValue, barMax, extra) {
    return '<div class="card"><h3>' + title + '</h3>' +
      rows.map(r =>
        '<div class="hs-row">' +
        '<span class="hs-name">' + (r.id.endsWith('/') ? r.id.slice(0, -1) : r.id) + '</span>' +
        (extra ? extra(r) : '') +
        '<div class="hs-bar-wrap"><div class="hs-bar" style="width:' +
          Math.round(barValue(r) / barMax * 100) + '%;background:' + RISK_COLOR[r.maxRisk] + '"></div></div>' +
        '<span class="hs-count">' + barValue(r) + '</span>' +
        '</div>'
      ).join('') +
      '</div>';
  }

  el.innerHTML =
    card('Most Decisions', byDec, r => r.decisions, maxDec, null) +
    card('Most Rejections', byRej.length ? byRej : [{id:'(none yet)',decisions:0,rejections:0,maxRisk:'none',titles:[]}],
         r => r.rejections, Math.max(maxRej, 1), null) +
    card('Highest Risk Modules', byRisk.length ? byRisk : [{id:'(none yet)',decisions:0,rejections:0,maxRisk:'none',titles:[]}],
         r => r.decisions, maxDec,
         r => '<span class="risk-badge risk-' + r.maxRisk + '-bg">' + r.maxRisk + '</span> ') +
    card('Most Connected', mostLinked, r => r.links, Math.max(1,...mostLinked.map(r => r.links)), null);
}

// Draw topology on load
requestAnimationFrame(drawGraph);
</script>
</body>
</html>`
}
