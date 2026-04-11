/**
 * Local embedding engine for Chronicle semantic search.
 *
 * Uses @huggingface/transformers (ONNX, runs fully in Node.js — no Python, no server).
 * Model: Xenova/all-MiniLM-L6-v2 — 22MB, 384-dim, fast inference, good code/text quality.
 *
 * Architecture:
 *  - Embeddings are computed lazily and cached to .lore/embeddings.json
 *  - Cache keyed by SHA-256 of content, so unchanged decisions are never re-embedded
 *  - First run downloads the model (~22MB) to ~/.cache/huggingface/
 *  - Subsequent runs load from disk cache in <100ms
 *
 * Graceful degradation: if @huggingface/transformers is not installed, all functions
 * return null/empty and callers fall back to heuristic ranking.
 */

import { createHash } from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'
export const EMBEDDING_DIM = 384

export interface EmbeddingCache {
  model: string
  entries: Record<string, number[]>   // content hash → embedding vector
}

// Lazy-loaded pipeline — null until first embed() call
let pipeline: ((texts: string[], opts?: object) => Promise<{ data: Float32Array }[]>) | null = null
let pipelineLoading = false

/**
 * Initialize the embedding pipeline (downloads model on first run).
 * Returns null if @huggingface/transformers is not installed.
 */
export async function getEmbeddingPipeline() {
  if (pipeline) return pipeline
  if (pipelineLoading) {
    // Wait for in-flight initialization
    while (pipelineLoading) await new Promise(r => setTimeout(r, 50))
    return pipeline
  }

  try {
    pipelineLoading = true
    // Use Function constructor to prevent TypeScript from type-checking this optional import.
    // @huggingface/transformers is an optionalDependency — if not installed we catch and return null.
    // eslint-disable-next-line no-new-func
    const hf = await (new Function('spec', 'return import(spec)'))('@huggingface/transformers') as {
      pipeline: (task: string, model: string, opts?: object) => Promise<(texts: string[], opts?: object) => Promise<{ data: Float32Array } | { data: Float32Array }[]>>
      env: { cacheDir: string }
    }
    // Store models in ~/.cache/huggingface/ (standard HF cache location)
    hf.env.cacheDir = join(process.env.HOME ?? '~', '.cache', 'huggingface')
    const pipe = await hf.pipeline('feature-extraction', EMBEDDING_MODEL, {
      dtype: 'fp32',
    })
    // Wrap to normalize output shape
    pipeline = async (texts: string[]) => {
      const output = await pipe(texts, { pooling: 'mean', normalize: true })
      return Array.isArray(output) ? output as { data: Float32Array }[] : [output as { data: Float32Array }]
    }
    return pipeline
  } catch {
    return null   // transformers not installed or model unavailable
  } finally {
    pipelineLoading = false
  }
}

/**
 * Embed a single text string. Returns null if transformers unavailable.
 */
export async function embed(text: string): Promise<number[] | null> {
  const pipe = await getEmbeddingPipeline()
  if (!pipe) return null
  try {
    const [result] = await pipe([text.slice(0, 512)])  // truncate to model max
    return Array.from(result.data)
  } catch {
    return null
  }
}

/**
 * Embed multiple texts in a single batch. Returns null if transformers unavailable.
 */
export async function embedBatch(texts: string[]): Promise<number[][] | null> {
  if (texts.length === 0) return []
  const pipe = await getEmbeddingPipeline()
  if (!pipe) return null
  try {
    const BATCH = 32   // MiniLM handles 32 comfortably in ~200ms
    const results: number[][] = []
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH).map(t => t.slice(0, 512))
      const outputs = await pipe(batch)
      results.push(...outputs.map(o => Array.from(o.data)))
    }
    return results
  } catch {
    return null
  }
}

/**
 * Cosine similarity between two normalized vectors (range: -1 to 1).
 * Assumes vectors are already L2-normalized (which MiniLM outputs by default).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot   // already normalized → dot product = cosine similarity
}

// ── Persistent cache ──────────────────────────────────────────────────────────

const CACHE_FILENAME = 'embeddings.json'

function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

export function loadEmbeddingCache(loreRoot: string): EmbeddingCache {
  const path = join(loreRoot, '.lore', CACHE_FILENAME)
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as EmbeddingCache
    } catch { /* corrupt cache — start fresh */ }
  }
  return { model: EMBEDDING_MODEL, entries: {} }
}

export function saveEmbeddingCache(loreRoot: string, cache: EmbeddingCache): void {
  const path = join(loreRoot, '.lore', CACHE_FILENAME)
  writeFileSync(path, JSON.stringify(cache, null, 2), 'utf8')
}

/**
 * Get embeddings for a list of texts, using cache where possible.
 * Only texts not in cache are sent to the model.
 *
 * @returns array of [text, embedding] pairs, or null if model unavailable
 */
export async function getEmbeddings(
  texts: string[],
  cache: EmbeddingCache
): Promise<Array<{ text: string; hash: string; vec: number[] }> | null> {
  const results: Array<{ text: string; hash: string; vec: number[] }> = []
  const toEmbed: Array<{ text: string; hash: string; idx: number }> = []

  // Split: cache hits vs misses
  for (let i = 0; i < texts.length; i++) {
    const hash = contentHash(texts[i])
    const cached = cache.entries[hash]
    if (cached) {
      results[i] = { text: texts[i], hash, vec: cached }
    } else {
      toEmbed.push({ text: texts[i], hash, idx: i })
    }
  }

  if (toEmbed.length > 0) {
    const vecs = await embedBatch(toEmbed.map(t => t.text))
    if (!vecs) return null   // model unavailable
    for (let j = 0; j < toEmbed.length; j++) {
      const { text, hash, idx } = toEmbed[j]
      const vec = vecs[j]
      cache.entries[hash] = vec
      results[idx] = { text, hash, vec }
    }
  }

  return results
}
