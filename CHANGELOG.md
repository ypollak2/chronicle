# Changelog

All notable changes to Chronicle are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [0.9.0] — 2026-04-11

### Added

**Decision relationship DAG (`chronicle relate`) (I1)**
- `chronicle relate "<title>" --depends-on "<title>"` — record that a decision builds on another
- `chronicle relate "<title>" --supersedes "<title>"` — mark an old decision as replaced
- `chronicle relate "<title>" --related-to "<title>"` — soft cross-reference between decisions
- `chronicle relate --list` — print the full relation graph across all decisions
- Relations stored as `<!-- relations:{...} -->` inline HTML comments in `decisions.md` rows (backward-compatible with existing stores)
- `applyRelationToContent`, `buildRelationGraph`, `getRelatedRows`, `parseRelations`, `serializeRelations`, `addRelationToRow`, `removeRelationFromRow`, `extractTitleFromRow` exported from `@chronicle/core`

**Business/product context layer (`chronicle context`) (I2)**
- `chronicle context add --goal|--constraint|--team|--stack|--non-goal <text>` — add a fact to `.lore/context.md`
- `chronicle context remove ...` — remove a context fact
- `chronicle context show` — print current project context
- `chronicle context edit` — open `context.md` in `$EDITOR`
- `chronicle inject` now prepends the project context block at the top of every output
- `readContext`, `writeContext`, `addContextFact`, `removeContextFact`, `formatContextForInject` exported from `@chronicle/core`

**Ownership tracking (`chronicle who`) (I3)**
- `chronicle who <file>` — show owner(s) and all recorded decisions + risks for a file
- Reads CODEOWNERS automatically (checks `CODEOWNERS`, `.github/CODEOWNERS`, `.gitlab/CODEOWNERS`)
- Falls back to `.lore/ownership.md` (format: `- \`pattern\`: @owner`)
- `chronicle capture` now stamps `<!-- author:email -->` on each captured decision row
- `chronicle inject --files` now includes a `## File Ownership` section when ownership is defined
- `loadOwnership`, `getOwnersForFile`, `parseAuthorFromRow`, `setAuthorOnRow`, `buildOwnershipSection`, `writeLoreOwnership` exported from `@chronicle/core`

**CI / Server-side automation**
- `chronicle verify` — CI gate: exits 1 when `.lore/` lags by more than `--max-lag` commits (default 5); `--json` for machine-readable output
- `chronicle process` — batch processor for GitHub Actions: processes all uncached commits in one pass, writes `.lore/process.log`, exits 1 on LLM errors
- `.github/workflows/chronicle.yml` — official GitHub Actions workflow that triggers on push to main, runs `chronicle process`, and commits updated `.lore/` back with `[skip ci]` — closes the "repo maintains itself" loop

**Comprehensive test suite (149 tests across 9 suites)**
- `extraction-parsing.test.ts` — 21 tests covering malformed JSON, HTML-wrapped responses, null fields, truncated output, code block variations, and prompt completeness
- `ranker.test.ts` — 26 tests for `parseDecisionsTable`, `scoreRow` (file match, age decay, risk/confidence bonus), `rankDecisions` (sort order, semantic blend, topN), `estimateTokens`, `trimToTokenBudget`
- `rag-quality.test.ts` — 28 behavioral tests: "does the store contain the right knowledge?" — decisions completeness, rejections format, risks content, evolution eras, deep ADR structure, inject output ranking, staleness, token budget, relations DAG, business context
- `pipeline.test.ts` — 10 end-to-end integration tests using real git repos (temp fixture) + mock LLM: feature commit → decisions.md, security → high-risk, rejection → rejected.md, noise filtering, store write correctness, deep ADR creation, cache prevents re-processing
- `fixtures.ts` — shared fixture factory: `buildProjectRepo()` (7-commit git repo covering all change types), `buildPopulatedLore()` (pre-populated `.lore/` for inject tests), `buildMockLLM()` (keyword-aware mock returning realistic ExtractionResults)

### Fixed
- `parseExtractionResponse` now filters non-object elements from arrays (LLM hallucination of `[1, 2, 3]` no longer passes through as decisions)
- `scoreRow` recentFiles matching now uses prefix matching: a row affecting `src/auth/` correctly matches a recent file `src/auth/jwt.ts`
- Extraction cache now marks noise commits (zero results) as processed, preventing re-querying on the second pass
- `buildExtractionPrompt` now includes the commit hash in the prompt so the LLM can return it in each result object (enabling accurate cache keying)
- Evolution test updated: `buildEvolution` correctly synthesizes a single `v0.1 (initial)` era for repos with no git tags (time-based era synthesis was added in v0.3.0 but the test expectation was not updated)

---

## [0.8.0] — 2026-04-11

### Added

**Multi-source knowledge ingestion**

`chronicle add` — register additional knowledge sources:
- `--repo <path|url>` — secondary git repo (clones remotes to `~/.chronicle/repos/`); decisions extracted immediately
- `--dir <path>` — local directory (`.md`, `.ts`, `.py`, `.go`, etc.)
- `--url <url>` — web page (HTML stripped to text)
- `--pdf <path>` — PDF file (text PDFs; requires optional `pdf-parse`)
- `--list` / `--remove <id>` — manage registered sources
- Source registry persisted at `.lore/sources.json`

`chronicle ingest` — index dir/url/pdf sources into `.lore/chunks/{sourceId}/`:
- Chunks text at ~500-token boundaries (paragraph-aware)
- Skips already-ingested sources unless `--force`
- `--id <id>` to re-ingest a single source

**Unified search (M4)**
- `chronicle search` now also scans `.lore/chunks/` in keyword mode
- Semantic/hybrid modes already work across all embedded content

**Git merge driver for decisions.md (M5)**
- `chronicle hooks install` now registers `merge.chronicle-decisions` in `.git/config`
- Adds `.lore/decisions*.md merge=chronicle-decisions` to `.gitattributes`
- `chronicle merge-driver <base> <ours> <theirs>` (internal, called by git):
  - Union-merges table rows from both branches
  - Deduplicates by title (keeps newest date)
  - Exits 0 → conflict-free merge; exits 1 → unresolvable

**Source abstraction layer (`@chronicle/core`)**
- `SourceConfig`, `SourceType`, `SourceRegistry` types
- `loadSourceRegistry`, `saveSourceRegistry`, `addSource`, `removeSource`, `listSources`, `getSource`, `markIngested`, `deriveSourceId`
- `chunkText`, `ingestDir`, `ingestUrl`, `ingestPdf` from `ingestor.ts`

---

## [0.7.0] — 2026-04-11

### Added

**Local embedding engine (`@chronicle/core`)**
- `embed(text)` / `embedBatch(texts)` — MiniLM-L6-v2 via `@huggingface/transformers` (22MB, fully offline)
- `cosineSimilarity(a, b)` — dot product on normalized vectors
- `loadEmbeddingCache` / `saveEmbeddingCache` — SHA-256 content-keyed JSON cache at `.lore/embeddings.json`
- `getEmbeddings(texts, cache)` — batch embedding with cache deduplication (only new content is embedded)
- `@huggingface/transformers` is an `optionalDependency` — Chronicle works without it, embedding features degrade gracefully to heuristic mode

**Semantic search (`chronicle search`)**
- `--semantic` — pure vector similarity search using MiniLM embeddings
- `--hybrid` — linear blend: 0.7 × semantic + 0.3 × keyword score
- Visual score bar output (█░░░ style) with source attribution
- Graceful fallback to keyword search with install hint if transformers not available

**Semantic inject ranking (`chronicle inject`)**
- `--query <text>` — natural language query that re-ranks decision rows by semantic similarity
- Phase 2 ranker: `0.6 × semantic + 0.4 × heuristic` blend when `--query` provided
- `buildSemanticScores(rows, query)` exported from `@chronicle/core`

**Incremental vector index (post-commit hook)**
- `buildEmbeddingIndex(root)` — indexes all decisions, rejects, risks; skips cached content
- Called automatically by `chronicle capture` after each commit (only new decisions are embedded)

**RAG quality harness (`chronicle eval`)**
- `chronicle eval` — runs 4 KPI checks: Decision Recall, Rejection Hit Rate, Semantic MRR@5, False Confidence Rate
- `chronicle eval --init` — bootstraps `.lore/.eval.json` from existing decisions (ready to run immediately)
- `--json` for machine-readable output; `--verbose` for per-case details
- Exits 1 if any KPI is below target (suitable for CI)
- KPI targets: Recall ≥ 80%, Rejection Hit ≥ 90%, MRR@5 ≥ 0.70, False Confidence ≤ 10%

### Changed
- `rankDecisions()` now accepts `semanticScores?: Map<string, number>` for hybrid scoring

---

## [0.6.0] — 2026-04-11

### Added

**Relevance-ranked inject (`chronicle inject`)**
- `--top <n>` — return only the N most relevant decisions (ranked by heuristic score)
- `--tokens <n>` — auto-trim output to fit within N tokens (~4 chars/token)
- `--min-confidence <n>` — omit decisions below a confidence threshold (0.0–1.0)
- `rankDecisions()` in `@chronicle/core` — heuristic scoring: file match ×3, recent file ×1, risk bonus (high=+2, medium=+1), age decay, confidence bonus
- `trimToTokenBudget()` — greedy section trimmer with partial truncation fallback

**Confidence scores on decisions**
- LLM extraction now returns a `confidence` field (0.0–1.0) per decision
- Stored as `<!-- confidence:0.72 -->` inline HTML comments in `decisions.md` rows
- Backward-compatible: existing stores default to `confidence=1.0`

**Staleness detection (`chronicle inject --no-stale`)**
- Automatically flags decisions whose affected files have been significantly modified since the decision was recorded
- One-shot `git log --name-only` scan builds a `FileModMap` — no per-decision git calls
- Stale decisions annotated with `<!-- stale -->` and surfaced as a `⚠️ Potentially Stale Decisions` warning block in inject output
- Disable with `--no-stale` for faster runs without git access

**Session history index (`chronicle session save`)**
- Every `session save` now rebuilds `.lore/sessions/_index.md` — a compact markdown table of all sessions
- `chronicle inject` includes the history index + most recent raw session (not just the last session)
- `_index.md` is excluded from `session list` and `session show` output

**Graph monorepo awareness (`chronicle graph`)**
- `--depth <n>` — control how many path segments to group by (default: 2)
- `--monorepo` — force monorepo mode (auto-detected from `packages/`, `apps/`, `services/`, `libs/` dirs)
- Paths under monorepo root dirs always group at depth 2 regardless of `--depth`
- Monorepo badge displayed in graph top-bar when detected

**@chronicle/core exports**
- `rankDecisions`, `parseDecisionsTable`, `scoreRow`, `estimateTokens`, `trimToTokenBudget` (from `ranker.ts`)
- `buildFileModMap`, `annotateStaleDecisions`, `formatStaleWarning` (from `staleness.ts`)

### Changed
- `decisions.md` table now includes `Date` as first column (added in G1)
- Graph `buildGraphData()` accepts `GraphOptions` with `depth` and `monorepo` fields

---

## [0.5.0] — 2026-04-10

### Added

**New Commands**
- `chronicle doctor` — validates `.lore/` health: checks for missing files, broken ADR links, cache integrity, and git hook installation
- `chronicle search <query>` — full-text search across all `.lore/` markdown files with highlighted matches and file:line context; `--json` flag for machine output
- `chronicle serve [--port]` — zero-dependency local web viewer (dark theme, sidebar nav, live search); opens in browser automatically
- `chronicle session save|list|show` — save and browse session notes in `.lore/sessions/`; supports piped input for auto-summaries

**Parallel Extraction**
- `extractFromCommits()` now runs LLM batches concurrently (default `concurrency=4` for API providers, `1` for Ollama)
- `--concurrency <n>` flag on `init` and `deepen` for manual override
- Benchmark: 4 batches in parallel → ~4× speedup vs sequential for Anthropic/Gemini/OpenAI

**Progressive History (`--limit`)**
- `chronicle init --limit <n>` — cap initial scan to N most recent commits
- `chronicle deepen --limit <n>` — process additional batches incrementally
- Enables fast first-run (20 commits → ~5s with API) then deepening as needed

**LLM Provider Updates**
- Gemini updated to `gemini-2.5-flash` with `thinkingBudget: 0` (thinking mode disabled for structured extraction — 8× faster)
- All providers now defensively handle partial LLM responses (missing `title`, `affects`, `risk` fields no longer crash)

**Null-safety fixes**
- `buildStore`, `formatDeepADR`, `formatDecisionEntry`, `formatRejectionEntry` all handle LLM responses missing optional fields
- Cache fallback: results matched to commits by `hash` field, with positional fallback

### Fixed
- `deepen` now accepts `--llm`, `--limit`, `--concurrency` (was hardcoded to anthropic, no limit)
- `git log` delimiter changed from `|` to `\x1f` (ASCII unit separator) — fixes parsing for repos with `|` in commit subjects

---

## [0.4.0] — 2026-04-10

### Added

**Semantic Clustering Extraction (`strategy: 'clustered'`)**
- `extractFilesFromDiff()` — parses `diff --git a/X b/X` headers to extract the file set touched by a commit
- `clusterCommitsByFileOverlap()` — groups commits into cohesive clusters where all members share at least one touched file
- Isolated commits (no file overlap with neighbours) are batched together up to 4 per group to avoid excessive LLM calls
- Clusters respect `MAX_CLUSTER_SIZE=8` and `MAX_CLUSTER_CHARS=8000` to stay within LLM context limits
- `strategyClustered()` — runs one LLM call per semantic cluster instead of per fixed-size batch
- Pass `{ strategy: 'clustered' }` to `extractFromCommits()` to use the new strategy

**Why it matters**: The v1 `simple` strategy could batch "add JWT auth" with unrelated CSS tweaks. The `clustered` strategy ensures the LLM sees a coherent feature narrative — all commits that touched `auth/` together — yielding richer rationale extraction.

**Tests**
- 8 new clustering tests: file parsing, overlap detection, singleton merging, MAX_CLUSTER_SIZE cap, LLM call count
- Total: 64 tests passing (58 TS + 6 Python)

---

## [0.3.0] — 2025-04-10

### Added

**Evolution Records (`chronicle evolution`)**
- `buildEvolution()` — groups git history into eras (one per release tag + current untagged work)
- Each era contains: decisions made, rejections logged, most-changed files, date range
- `renderEvolutionMarkdown()` — renders eras to human+AI-readable `.lore/evolution.md`
- `mergeWithExisting()` — preserves manually-written `> summary` fields when regenerating
- `chronicle evolution --regen` — force-rebuild; `--view` — print to stdout
- Auto-generates `evolution.md` at the end of `chronicle init`
- Evolution included in `chronicle inject` output (first era, compact)

**Terminal Status Indicator**
- Before every write command: `◆ chronicle │ N decisions · N rejected · N ADRs · last capture: Xm ago`
- After every write command: `◆ chronicle wrote +N decisions, +N rejections` (only if something changed)
- Written to stderr — doesn't pollute `chronicle inject` stdout pipe
- Active for: `init`, `deepen`, `setup`, `diagram`, `evolution`, `capture`

**Tests**
- 12 evolution tests: tag detection, era chaining, HEAD detection, rendering, merge behavior
- Total: 62 tests passing (56 TS + 6 Python)

## [0.2.0] — 2025-04-10

### Added

**Tool adapters (`chronicle setup --tool=<name>`)**
- `claude-code` / `openclaw` — MCP server config (`.claude/mcp.json`) + SessionStart/Stop hooks (`.claude/settings.json`); merges with existing config
- `cursor` — generates `.cursorrules` with current `.lore/` context
- `aider` — writes `.aider.conf.yml` with `--read` entries for `.lore/` files; idempotent
- `gemini-cli` — generates `GEMINI.md` with compressed context
- `copilot` — generates `.github/copilot-instructions.md`
- `codex` — appends Chronicle context to `AGENTS.md`
- `opencode` — writes `.opencode.json` with `contextFiles` entries
- `trae` / `factory` — universal pipe instructions (`chronicle inject | <tool>`)
- `chronicle setup` with no args lists all available integrations
- `chronicle setup --all` installs every adapter at once

**ASCII Diagrams (`chronicle diagram`)**
- All diagrams are plain `.txt` files — render anywhere (terminal, GitHub, AI context windows)
- `architecture.txt` — module tree grouped by directory, relationships from decision log
- `dependencies.txt` — import graph from source files; highlights high-blast-radius files (≥3 dependents)
- `evolution.txt` — timeline from git tags + dated decision entries, grouped by year

**Tests**
- 11 adapter tests covering install, idempotency, merge behavior, pipe tools
- Total: 50 tests passing (44 TS + 6 Python)

### Changed
- Diagram files use `.txt` extension instead of `.mmd` — ASCII format, no renderer needed

## [Unreleased]

### Planned
- Phase 8 (v3): Two-pass extraction (cheap LLM filter → quality model for complex decisions)

---

## [0.1.0] — 2025-04-10

Initial release of Chronicle — AI-native development memory.

### Added

**Core (`@chronicle/core`)**
- `store.ts` — file-based markdown store with `findLoreRoot` (walks up like git), `readStore`, `writeStore`, `appendToStore`, `writeDeepDecision`, `initStore`
- `scanner.ts` — git history scanner with noise filtering (chore/style/docs/test prefixes), diff size threshold (≥20 changed lines), diff capping (4000 chars), tag detection
- `extractor.ts` — LLM extraction engine with pluggable strategy pattern; v1 `simple` strategy (batches of 6, ≤5000 chars); `clustered` and `two-pass` slots reserved for v2/v3
- `cache.ts` — SHA-keyed JSON file cache; prevents reprocessing commits across runs
- `ExtractionCache` interface for swappable cache backends (in-memory, file, future SQLite)

**CLI (`chronicle-dev`)**
- `chronicle init [--depth]` — bootstraps `.lore/` from git history; progressive scan defaults to 6 months
- `chronicle inject [--files] [--full] [--format]` — outputs compressed context to stdout; scopes to relevant files; supports `markdown`, `xml`, `plain` formats
- `chronicle deepen [--depth]` — extends scan further back without reprocessing cached commits
- `chronicle hooks install/remove` — installs `post-commit` (async decision capture) and `prepare-commit-msg` (risk annotation) git hooks
- Internal `chronicle capture` and `chronicle enrich-commit` commands (invoked by hooks)

**MCP Server (`@chronicle/mcp`)**
- `chronicle_get_context` — injects compressed project context; scopes to files if specified
- `chronicle_log_decision` — AI logs architectural choices mid-session
- `chronicle_log_rejection` — AI logs abandoned approaches (crown jewel: prevents future repetition)
- `chronicle_get_risks` — returns blast-radius info before touching a file
- `chronicle_save_session` — summarizes session to `.lore/sessions/YYYY-MM-DD.md`

**Python wrapper (`chronicle-dev` on PyPI)**
- Thin subprocess wrapper; delegates all logic to Node CLI
- Detects Node ≥ 20; falls back to `npx chronicle-dev` if not globally installed
- Entry point: `chronicle` command identical to npm version

**Project**
- `.lore/` store structure: `index.md`, `decisions.md`, `decisions/`, `rejected.md`, `risks.md`, `evolution.md`, `diagrams/`, `sessions/`
- Hub-and-spoke ADR model: shallow decisions inline, complex decisions in `decisions/<slug>.md`
- `ARCHITECTURE.md` — full system design documentation
- GitHub Actions CI (test on every push/PR) and Release (publish npm + PyPI on tag)
- Vitest test suite for core package (store, extractor, scanner)
- pytest suite for Python wrapper

### Architecture decisions
- Markdown-only store: no vector DB, no embeddings — plain files readable by any LLM
- Commit SHA cache ensures bootstrap is idempotent and cost-efficient
- Strategy pattern in extractor: v1 ships today, v2/v3 are drop-in replacements
- Python package delegates to Node — single source of truth, no duplication

[Unreleased]: https://github.com/ypollak2/chronicle/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ypollak2/chronicle/releases/tag/v0.1.0
