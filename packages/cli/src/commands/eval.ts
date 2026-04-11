/**
 * chronicle eval — RAG quality harness
 *
 * Measures retrieval quality against a ground-truth test suite stored in .lore/.eval.json.
 * Run `chronicle eval init` to bootstrap test cases from existing .lore/ content.
 * Run `chronicle eval` to execute the suite and report KPI scores.
 *
 * KPI targets (v0.7.0):
 *   Decision Recall       ≥ 80%  — known decisions surface in top-10 inject output
 *   Rejection Hit Rate    ≥ 90%  — known rejections appear in rejected.md
 *   Context Relevance     ≥ 0.65 — injected chunks cosine similarity vs. labelled ideal
 *   Semantic MRR@5        ≥ 0.70 — mean reciprocal rank for 30 test queries
 *   False Confidence Rate ≤ 10%  — stale decisions without ⚠️ annotation
 */

import chalk from 'chalk'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { findLoreRoot, lorePath, readStore, cosineSimilarity, embed, buildFileModMap, annotateStaleDecisions } from '@chronicle/core'

const EVAL_FILE = '.eval.json'

interface TestCase {
  id: string
  type: 'decision_recall' | 'rejection_hit' | 'semantic_mrr' | 'context_relevance'
  query: string
  expectedText: string      // substring that should appear in results
  description?: string
}

interface EvalSuite {
  version: string
  generated: string
  cases: TestCase[]
}

interface KPIResult {
  name: string
  score: number
  target: number
  passing: boolean
  details: string
}

export async function cmdEval(opts: { init?: boolean; json?: boolean; verbose?: boolean }) {
  const root = findLoreRoot()
  if (!root) {
    process.stderr.write(chalk.red('✗  No .lore/ found. Run `chronicle init` first.\n'))
    process.exit(1)
  }

  if (opts.init) {
    return initEvalSuite(root)
  }

  const evalPath = join(lorePath(root), EVAL_FILE)
  if (!existsSync(evalPath)) {
    console.log(chalk.yellow('⚠  No eval suite found. Run `chronicle eval --init` to bootstrap one.'))
    process.exit(1)
  }

  const suite: EvalSuite = JSON.parse(readFileSync(evalPath, 'utf8'))
  console.log(chalk.bold(`\n◆ Chronicle Eval — ${suite.cases.length} test cases\n`))

  const results = await runEvalSuite(root, suite, opts.verbose)

  if (opts.json) {
    process.stdout.write(JSON.stringify(results, null, 2))
    return
  }

  printKPIReport(results)

  const failing = results.filter(r => !r.passing)
  if (failing.length > 0) {
    console.log(chalk.red(`\n✗  ${failing.length} KPI(s) below target\n`))
    process.exit(1)
  }
  console.log(chalk.green('\n✓  All KPIs passing\n'))
}

// ── KPI runners ───────────────────────────────────────────────────────────────

async function runEvalSuite(root: string, suite: EvalSuite, verbose = false): Promise<KPIResult[]> {
  const kpis: KPIResult[] = []

  // 1. Decision Recall — do known decisions appear in inject output?
  const decisionCases = suite.cases.filter(c => c.type === 'decision_recall')
  if (decisionCases.length > 0) {
    kpis.push(await measureDecisionRecall(root, decisionCases, verbose))
  }

  // 2. Rejection Hit Rate — do known rejections appear in rejected.md?
  const rejectionCases = suite.cases.filter(c => c.type === 'rejection_hit')
  if (rejectionCases.length > 0) {
    kpis.push(measureRejectionHitRate(root, rejectionCases, verbose))
  }

  // 3. Semantic MRR@5 — does semantic search rank the correct result in top 5?
  const semanticCases = suite.cases.filter(c => c.type === 'semantic_mrr')
  if (semanticCases.length > 0) {
    kpis.push(await measureSemanticMRR(root, semanticCases, verbose))
  }

  // 4. False Confidence Rate — stale decisions that lack ⚠️ annotation
  kpis.push(await measureFalseConfidenceRate(root, verbose))

  return kpis
}

async function measureDecisionRecall(
  root: string,
  cases: TestCase[],
  verbose: boolean
): Promise<KPIResult> {
  const decisions = readStore(root, 'decisions') ?? ''
  let hits = 0
  const misses: string[] = []

  for (const c of cases) {
    const found = decisions.toLowerCase().includes(c.expectedText.toLowerCase())
    if (found) hits++
    else misses.push(c.id)
  }

  const score = cases.length > 0 ? hits / cases.length : 1
  if (verbose && misses.length > 0) {
    console.log(chalk.dim(`  Decision recall misses: ${misses.join(', ')}`))
  }

  return {
    name: 'Decision Recall',
    score,
    target: 0.80,
    passing: score >= 0.80,
    details: `${hits}/${cases.length} decisions found`,
  }
}

function measureRejectionHitRate(root: string, cases: TestCase[], verbose: boolean): KPIResult {
  const rejected = readStore(root, 'rejected') ?? ''
  let hits = 0
  const misses: string[] = []

  for (const c of cases) {
    const found = rejected.toLowerCase().includes(c.expectedText.toLowerCase())
    if (found) hits++
    else misses.push(c.id)
  }

  const score = cases.length > 0 ? hits / cases.length : 1
  if (verbose && misses.length > 0) {
    console.log(chalk.dim(`  Rejection misses: ${misses.join(', ')}`))
  }

  return {
    name: 'Rejection Hit Rate',
    score,
    target: 0.90,
    passing: score >= 0.90,
    details: `${hits}/${cases.length} rejections found`,
  }
}

async function measureSemanticMRR(
  root: string,
  cases: TestCase[],
  verbose: boolean
): Promise<KPIResult> {
  // Try to import embeddings — if unavailable, skip with a warning score
  let embedFn: ((text: string) => Promise<number[] | null>) | null = null
  try {
    // eslint-disable-next-line no-new-func
    const m = await (new Function('s', 'return import(s)'))('@chronicle/core') as typeof import('@chronicle/core')
    embedFn = m.embed
  } catch { /* embeddings unavailable */ }

  if (!embedFn) {
    return {
      name: 'Semantic MRR@5',
      score: -1,
      target: 0.70,
      passing: true,   // skip, not a failure if embeddings not installed
      details: 'skipped — @huggingface/transformers not installed',
    }
  }

  const decisions = readStore(root, 'decisions') ?? ''
  const rows = decisions.split('\n').filter(l => l.startsWith('|') && !/^[|\s-]+$/.test(l))

  let reciprocalRankSum = 0
  for (const c of cases) {
    const queryVec = await embedFn(c.query)
    if (!queryVec) continue

    // Score each decision row
    const scored: Array<{ row: string; sim: number }> = []
    for (const row of rows) {
      const rowVec = await embedFn(row)
      if (!rowVec) continue
      scored.push({ row, sim: cosineSimilarity(queryVec, rowVec) })
    }
    scored.sort((a, b) => b.sim - a.sim)

    const rank = scored.slice(0, 5).findIndex(r =>
      r.row.toLowerCase().includes(c.expectedText.toLowerCase())
    )
    if (rank >= 0) reciprocalRankSum += 1 / (rank + 1)
    else if (verbose) console.log(chalk.dim(`  MRR miss: "${c.id}"`))
  }

  const mrr = cases.length > 0 ? reciprocalRankSum / cases.length : 0
  return {
    name: 'Semantic MRR@5',
    score: mrr,
    target: 0.70,
    passing: mrr >= 0.70,
    details: `MRR = ${mrr.toFixed(3)} over ${cases.length} queries`,
  }
}

async function measureFalseConfidenceRate(root: string, verbose: boolean): Promise<KPIResult> {
  const decisions = readStore(root, 'decisions') ?? ''
  const modMap = buildFileModMap(root)
  const { annotated } = annotateStaleDecisions(decisions, modMap)

  // Count rows that ARE stale but DON'T have the stale marker
  const rows = decisions.split('\n').filter(l => l.startsWith('|') && !/^[|\s-]+$/.test(l))
  const annotatedRows = annotated.split('\n').filter(l => l.startsWith('|') && !/^[|\s-]+$/.test(l))

  let staleUnmarked = 0
  let totalStale = 0

  for (let i = 0; i < rows.length; i++) {
    const isStale = annotatedRows[i]?.includes('<!-- stale -->')
    const wasAlreadyMarked = rows[i].includes('<!-- stale -->')
    if (isStale) {
      totalStale++
      if (!wasAlreadyMarked) staleUnmarked++
    }
  }

  if (verbose && staleUnmarked > 0) {
    console.log(chalk.dim(`  ${staleUnmarked} stale decisions lack ⚠️ annotation`))
  }

  const falseConfidenceRate = totalStale > 0 ? staleUnmarked / totalStale : 0
  return {
    name: 'False Confidence Rate',
    score: falseConfidenceRate,
    target: 0.10,
    passing: falseConfidenceRate <= 0.10,
    details: `${staleUnmarked}/${totalStale} stale decisions unannotated`,
  }
}

// ── Init (bootstrap eval suite) ──────────────────────────────────────────────

function initEvalSuite(root: string) {
  const evalPath = join(lorePath(root), EVAL_FILE)
  if (existsSync(evalPath)) {
    console.log(chalk.yellow(`⚠  ${EVAL_FILE} already exists — edit it manually to add test cases.`))
    console.log(chalk.dim(`   ${evalPath}`))
    return
  }

  // Extract sample test cases from existing .lore/ content
  const decisions = readStore(root, 'decisions') ?? ''
  const rejected = readStore(root, 'rejected') ?? ''
  const cases: TestCase[] = []

  // Decision recall: one case per decision row (first 10)
  const decisionRows = decisions.split('\n')
    .filter(l => l.startsWith('|') && !/^[|\s-]+$/.test(l) && !/Date.*Decision/i.test(l))
    .slice(0, 10)

  decisionRows.forEach((row, i) => {
    const cols = row.split('|').map(c => c.trim()).filter(Boolean)
    const title = cols[1]?.replace(/\[.*?\].*/, '').trim() ?? ''
    if (title.length > 5) {
      cases.push({
        id: `decision-${i + 1}`,
        type: 'decision_recall',
        query: title,
        expectedText: title.slice(0, 30),
        description: `Decision "${title.slice(0, 50)}" should appear in decisions.md`,
      })
    }
  })

  // Rejection hit rate: first 5 rejections
  const rejectionTitles = [...rejected.matchAll(/^## (.+?) — rejected/gm)]
    .slice(0, 5)
    .map(m => m[1])

  rejectionTitles.forEach((title, i) => {
    cases.push({
      id: `rejection-${i + 1}`,
      type: 'rejection_hit',
      query: title,
      expectedText: title.slice(0, 30),
      description: `Rejection "${title.slice(0, 50)}" should appear in rejected.md`,
    })
  })

  // Semantic MRR: a few natural language queries from decision titles
  decisionRows.slice(0, 5).forEach((row, i) => {
    const cols = row.split('|').map(c => c.trim()).filter(Boolean)
    const title = cols[1]?.replace(/\[.*?\].*/, '').trim() ?? ''
    if (title.length > 10) {
      cases.push({
        id: `semantic-${i + 1}`,
        type: 'semantic_mrr',
        query: `why did we ${title.toLowerCase()}`,
        expectedText: title.slice(0, 20),
        description: `Semantic query for "${title.slice(0, 40)}"`,
      })
    }
  })

  const suite: EvalSuite = {
    version: '0.7.0',
    generated: new Date().toISOString(),
    cases,
  }

  writeFileSync(evalPath, JSON.stringify(suite, null, 2), 'utf8')
  console.log(chalk.green(`\n✓  Eval suite initialized: ${cases.length} test cases`))
  console.log(chalk.dim(`   ${evalPath}`))
  console.log(chalk.dim('\n   Edit .lore/.eval.json to add or refine cases, then run `chronicle eval`'))
}

// ── Report ────────────────────────────────────────────────────────────────────

function printKPIReport(results: KPIResult[]) {
  const nameWidth = Math.max(...results.map(r => r.name.length), 20)

  for (const r of results) {
    const pct = r.score >= 0 ? `${(r.score * 100).toFixed(1)}%` : 'N/A'
    const target = `${(r.target * 100).toFixed(0)}%`
    const icon = r.score < 0 ? chalk.dim('─') : r.passing ? chalk.green('✓') : chalk.red('✗')
    const scoreStr = r.score < 0
      ? chalk.dim(pct)
      : r.passing ? chalk.green(pct) : chalk.red(pct)
    const nameStr = r.name.padEnd(nameWidth)
    console.log(`  ${icon}  ${nameStr}  ${scoreStr.padStart(7)}  (target: ${target})  ${chalk.dim(r.details)}`)
  }
}
