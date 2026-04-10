import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { lorePath } from './store.js'
import type { ExtractionCache, ExtractionResult } from './extractor.js'

// Persists extraction results by commit SHA to .lore/.extraction-cache.json
// Ensures git bootstrap never reprocesses a commit, even across `chronicle init` runs
export function createFileCache(root: string): ExtractionCache {
  const path = join(lorePath(root), '.extraction-cache.json')
  const data: Record<string, ExtractionResult> = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : {}

  const save = () => writeFileSync(path, JSON.stringify(data, null, 2))

  return {
    has: (hash) => hash in data,
    get: (hash) => data[hash],
    set: (hash, result) => { data[hash] = result; save() },
  }
}
