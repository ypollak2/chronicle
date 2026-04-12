import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { lorePath } from './store.js'
import type { ExtractionCache, ExtractionResult } from './extractor.js'

// Persists extraction results by commit SHA to .lore/.extraction-cache.json
// Ensures git bootstrap never reprocesses a commit, even across `chronicle init` runs
export function createFileCache(root: string): ExtractionCache {
  const cachePath = join(lorePath(root), '.extraction-cache.json')
  const data: Record<string, ExtractionResult> = loadCacheFile(cachePath)

  const save = () => writeFileSync(cachePath, JSON.stringify(data, null, 2))

  return {
    has: (hash) => hash in data,
    get: (hash) => data[hash],
    set: (hash, result) => { data[hash] = result; save() },
  }
}

function loadCacheFile(cachePath: string): Record<string, ExtractionResult> {
  if (!existsSync(cachePath)) return {}

  let raw: string
  try {
    raw = readFileSync(cachePath, 'utf8')
  } catch (err) {
    process.stderr.write(`chronicle: could not read cache file: ${err}\n`)
    return {}
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const backupPath = cachePath + '.bak'
    process.stderr.write(
      `chronicle: .extraction-cache.json is corrupt — starting fresh.\n` +
      `  Backup saved to: ${backupPath}\n` +
      `  Run \`chronicle migrate\` to attempt recovery.\n`
    )
    try { writeFileSync(backupPath, raw) } catch { /* best-effort backup */ }
    return {}
  }

  if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
    const backupPath = cachePath + '.bak'
    process.stderr.write(
      `chronicle: .extraction-cache.json has unexpected format — starting fresh.\n` +
      `  Expected an object, got: ${Array.isArray(parsed) ? 'array' : typeof parsed}\n` +
      `  Backup saved to: ${backupPath}\n`
    )
    try { writeFileSync(backupPath, raw) } catch { /* best-effort backup */ }
    return {}
  }

  return parsed as Record<string, ExtractionResult>
}
