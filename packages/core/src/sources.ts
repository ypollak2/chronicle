/**
 * Source abstraction layer — M1 (v0.8.0)
 *
 * Chronicle can ingest knowledge from multiple source types beyond the primary git repo:
 *   git  — additional repositories (multi-repo federation)
 *   dir  — local file directories (docs, wikis, notes)
 *   url  — web pages (design docs, Notion exports, blog posts)
 *   pdf  — PDF files (specs, RFCs, design briefs)
 *
 * All sources are listed in .lore/sources.json.
 * The primary repo (the one containing .lore/) is always the implicit first source.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

export type SourceType = 'git' | 'dir' | 'url' | 'pdf'

export interface SourceConfig {
  id: string                        // slug derived from path/url
  type: SourceType
  path: string                      // local path or URL
  label?: string                    // human-readable name
  lastIngested?: string             // ISO timestamp of last successful ingest
  metadata?: Record<string, string> // arbitrary key-value context
}

export interface SourceRegistry {
  version: string
  sources: SourceConfig[]
}

const SOURCES_FILE = 'sources.json'
const CURRENT_VERSION = '0.8.0'

// ── Registry I/O ──────────────────────────────────────────────────────────────

export function loadSourceRegistry(loreRoot: string): SourceRegistry {
  const path = join(loreRoot, '.lore', SOURCES_FILE)
  if (!existsSync(path)) return { version: CURRENT_VERSION, sources: [] }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SourceRegistry
  } catch {
    return { version: CURRENT_VERSION, sources: [] }
  }
}

export function saveSourceRegistry(loreRoot: string, registry: SourceRegistry): void {
  const path = join(loreRoot, '.lore', SOURCES_FILE)
  writeFileSync(path, JSON.stringify(registry, null, 2), 'utf8')
}

// ── CRUD helpers ──────────────────────────────────────────────────────────────

/**
 * Derive a stable slug ID from a path or URL.
 * "https://github.com/acme/api" → "acme-api"
 * "/Users/foo/docs/rfcs"        → "rfcs"
 */
export function deriveSourceId(pathOrUrl: string): string {
  return pathOrUrl
    .replace(/^https?:\/\//, '')
    .replace(/^.*\//, '')           // keep last segment
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 40) || 'source'
}

export function addSource(registry: SourceRegistry, source: SourceConfig): SourceRegistry {
  const existing = registry.sources.findIndex(s => s.id === source.id || s.path === source.path)
  if (existing >= 0) {
    // Update in place
    const updated = [...registry.sources]
    updated[existing] = { ...updated[existing], ...source }
    return { ...registry, sources: updated }
  }
  return { ...registry, sources: [...registry.sources, source] }
}

export function removeSource(registry: SourceRegistry, id: string): SourceRegistry {
  return { ...registry, sources: registry.sources.filter(s => s.id !== id) }
}

export function listSources(registry: SourceRegistry): SourceConfig[] {
  return registry.sources
}

export function getSource(registry: SourceRegistry, id: string): SourceConfig | undefined {
  return registry.sources.find(s => s.id === id)
}

/**
 * Mark a source as successfully ingested (updates lastIngested timestamp).
 */
export function markIngested(registry: SourceRegistry, id: string): SourceRegistry {
  return {
    ...registry,
    sources: registry.sources.map(s =>
      s.id === id ? { ...s, lastIngested: new Date().toISOString() } : s
    ),
  }
}
