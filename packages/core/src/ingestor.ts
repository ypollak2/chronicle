/**
 * Non-git source ingestion — M3 (v0.8.0)
 *
 * Ingests local directories, URLs, and PDFs into .lore/chunks/{sourceId}/*.md
 * Each chunk is ~500 tokens and stored as a markdown file for downstream RAG.
 *
 * Dependencies:
 *   dir + url: Node.js built-ins only
 *   pdf: requires optional `pdf-parse` package (graceful skip if absent)
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync, existsSync } from 'fs'
import { join, extname, relative } from 'path'

const CHUNK_TOKENS = 500
const CHARS_PER_TOKEN = 4

// File extensions ingested from directories
const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs',
  '.java', '.kt', '.swift', '.rb', '.php', '.yaml', '.yml', '.toml', '.json',
  '.env.example', '.sh', '.sql', '.graphql', '.proto', '.tf',
])

/**
 * Split text into chunks of approximately maxTokens tokens.
 * Splits on paragraph boundaries (double newline) where possible.
 */
export function chunkText(text: string, maxTokens = CHUNK_TOKENS): string[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN
  const paragraphs = text.split(/\n{2,}/)
  const chunks: string[] = []
  let current = ''

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars) {
      if (current.trim()) chunks.push(current.trim())
      // If single paragraph is too long, hard-split it
      if (para.length > maxChars) {
        for (let i = 0; i < para.length; i += maxChars) {
          chunks.push(para.slice(i, i + maxChars).trim())
        }
        current = ''
      } else {
        current = para
      }
    } else {
      current = current ? `${current}\n\n${para}` : para
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.filter(c => c.length > 50)  // skip tiny/empty chunks
}

/** Write chunks to .lore/chunks/{sourceId}/ as numbered markdown files */
function writeChunks(outputDir: string, sourceId: string, chunks: string[], label: string): number {
  const dir = join(outputDir, sourceId)
  mkdirSync(dir, { recursive: true })

  // Clear old chunks for this source
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter(f => f.endsWith('.md'))) {
      try { require('fs').unlinkSync(join(dir, f)) } catch { /* skip */ }
    }
  }

  chunks.forEach((chunk, i) => {
    const filename = `${String(i + 1).padStart(4, '0')}.md`
    writeFileSync(join(dir, filename), `# ${label} — chunk ${i + 1}\n\n${chunk}\n`, 'utf8')
  })

  return chunks.length
}

/** Recursively collect all ingestion-eligible files from a directory */
function walkTextFiles(dir: string): string[] {
  const files: string[] = []
  if (!existsSync(dir)) return files
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      files.push(...walkTextFiles(full))
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(full)
    }
  }
  return files
}

/**
 * Ingest all text files from a local directory.
 * Each file becomes a document; large files are chunked.
 */
export async function ingestDir(
  sourceId: string,
  dirPath: string,
  outputDir: string
): Promise<number> {
  const files = walkTextFiles(dirPath)
  const allChunks: string[] = []

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf8')
      const relPath = relative(dirPath, file)
      // Prepend file path as context header
      const annotated = `<!-- source: ${relPath} -->\n${content}`
      allChunks.push(...chunkText(annotated))
    } catch { /* skip unreadable files */ }
  }

  return writeChunks(outputDir, sourceId, allChunks, `dir:${sourceId}`)
}

/**
 * Fetch a URL and ingest its text content.
 * Strips HTML tags; follows up to one redirect.
 */
export async function ingestUrl(
  sourceId: string,
  url: string,
  outputDir: string
): Promise<number> {
  let html: string
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Chronicle/0.8 (+https://github.com/chronicle)' },
      signal: AbortSignal.timeout(15_000),
    })
    html = await res.text()
  } catch (err) {
    throw new Error(`Failed to fetch ${url}: ${err}`)
  }

  // Strip HTML: remove scripts/styles, convert block elements to newlines, strip remaining tags
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?(p|div|h[1-6]|li|br|tr|td|th|section|article|header|footer)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const chunks = chunkText(`<!-- source: ${url} -->\n${text}`)
  return writeChunks(outputDir, sourceId, chunks, `url:${sourceId}`)
}

/**
 * Ingest a PDF file (text PDFs only — no OCR).
 * Requires optional `pdf-parse` package.
 */
export async function ingestPdf(
  sourceId: string,
  pdfPath: string,
  outputDir: string
): Promise<number> {
  let pdfParse: ((buf: Buffer) => Promise<{ text: string }>) | null = null
  try {
    // eslint-disable-next-line no-new-func
    const mod = await (new Function('s', 'return import(s)'))('pdf-parse')
    pdfParse = (mod.default ?? mod) as typeof pdfParse
  } catch {
    throw new Error('PDF ingestion requires pdf-parse: npm install pdf-parse')
  }

  const buffer = readFileSync(pdfPath)
  const { text } = await pdfParse!(buffer)
  const chunks = chunkText(`<!-- source: ${pdfPath} -->\n${text}`)
  return writeChunks(outputDir, sourceId, chunks, `pdf:${sourceId}`)
}
