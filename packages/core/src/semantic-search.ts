/**
 * Semantic search over .lore/ knowledge base.
 *
 * Strategy:
 *   --semantic:  pure vector search — embed query, find nearest decisions by cosine similarity
 *   --hybrid:    linear combination of semantic score + BM25-style keyword score (α=0.7)
 *
 * The index is built from decision rows (one row = one document).
 * Non-decision files (rejected.md, sessions/) are searched via keyword fallback.
 *
 * Index persistence: .lore/embeddings.json (content-hash keyed, survives decisions.md edits)
 */

import { readStore } from './store.js'
import {
  embed, getEmbeddings, cosineSimilarity,
  loadEmbeddingCache, saveEmbeddingCache,
} from './embeddings.js'

export interface SemanticResult {
  text: string          // the matched decision row / passage
  score: number         // 0–1 relevance score
  source: string        // 'decisions' | 'rejected' | 'risks' | etc.
  line?: number
}

/** α weight for semantic score in hybrid mode (1-α goes to keyword score) */
const HYBRID_ALPHA = 0.7

/**
 * Build a text corpus from .lore/ for embedding.
 * Each decision row becomes one document (granular retrieval).
 */
function buildCorpus(root: string): Array<{ text: string; source: string; line: number }> {
  const docs: Array<{ text: string; source: string; line: number }> = []

  const addLines = (content: string | null, source: string) => {
    if (!content) return
    content.split('\n').forEach((line, i) => {
      const t = line.trim()
      // Skip empty lines, table separators, and very short lines
      if (!t || /^\|[-| ]+\|$/.test(t) || t.length < 10) return
      docs.push({ text: t, source, line: i + 1 })
    })
  }

  addLines(readStore(root, 'decisions'), 'decisions')
  addLines(readStore(root, 'rejected'), 'rejected')
  addLines(readStore(root, 'risks'), 'risks')

  return docs
}

/**
 * Simple BM25-inspired keyword score (term frequency, no IDF for simplicity).
 * Normalized to 0–1 range.
 */
function keywordScore(text: string, queryTerms: string[]): number {
  const lower = text.toLowerCase()
  const matches = queryTerms.filter(t => lower.includes(t)).length
  return matches / Math.max(queryTerms.length, 1)
}

/**
 * Run semantic search against .lore/ decisions.
 * Returns top-N results sorted by score.
 *
 * @param root       repo root (parent of .lore/)
 * @param query      natural language query
 * @param opts.topN  max results (default: 10)
 * @param opts.hybrid  blend semantic + keyword scores
 * @returns null if embeddings unavailable (no transformers installed)
 */
export async function semanticSearch(
  root: string,
  query: string,
  opts: { topN?: number; hybrid?: boolean } = {}
): Promise<SemanticResult[] | null> {
  const { topN = 10, hybrid = false } = opts

  // Embed the query
  const queryVec = await embed(query)
  if (!queryVec) return null   // transformers not available

  // Build corpus
  const corpus = buildCorpus(root)
  if (corpus.length === 0) return []

  // Load or build embedding cache
  const cache = loadEmbeddingCache(root)
  const texts = corpus.map(d => d.text)
  const embedded = await getEmbeddings(texts, cache)
  if (!embedded) return null

  // Persist updated cache
  saveEmbeddingCache(root, cache)

  // Score each document
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2)

  const scored = corpus.map((doc, i) => {
    const vec = embedded[i]?.vec
    if (!vec) return { ...doc, score: 0 }

    const semScore = (cosineSimilarity(queryVec, vec) + 1) / 2   // normalize -1..1 → 0..1

    const score = hybrid
      ? HYBRID_ALPHA * semScore + (1 - HYBRID_ALPHA) * keywordScore(doc.text, queryTerms)
      : semScore

    return { ...doc, score }
  })

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .filter(r => r.score > 0.3)   // cutoff: below 0.3 is noise
    .map(({ text, score, source, line }) => ({ text, score, source, line }))
}

/**
 * Build (or rebuild) the full embedding index for .lore/.
 * Called by `chronicle search --reindex` or after `chronicle init`.
 * Returns the number of documents embedded.
 */
export async function buildEmbeddingIndex(root: string): Promise<number | null> {
  const corpus = buildCorpus(root)
  if (corpus.length === 0) return 0

  const cache = loadEmbeddingCache(root)
  const embedded = await getEmbeddings(corpus.map(d => d.text), cache)
  if (!embedded) return null

  saveEmbeddingCache(root, cache)
  return embedded.length
}
