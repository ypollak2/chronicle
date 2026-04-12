# Changelog

All notable changes to Chronicle are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [1.0.1] — 2026-04-12

### Fixed

**CI build — missing source files** (`add.ts`, `ingest.ts`)
- `add.ts` and `ingest.ts` were referenced by `cli.ts` but missing from the dist bundle, causing `CJS Build failed: Could not resolve './commands/add.js'` in the v1.0.0 release workflow
- Added the missing files so the tsup bundle compiles clean

**Release workflow — remove npm publish**
- Removed `Publish to npm` step and `registry-url` from `setup-node`; the npm registry requires a paid org account for publish
- Chronicle now publishes exclusively to **PyPI** + **GitHub Release**; no npm publish

**Eval suite and CI fixes committed to repo**
- `.lore/.eval.json` 20-case RAG eval suite added to repo
- CI matrix updated: removed `--extra agno` from `uv sync`, added agno integration test to ignore list (fixes Python 3.12/3.13 CI hang)

---

## [1.0.0] — 2026-04-12

Production-ready milestone. Chronicle can now maintain itself — the `.lore/` store is bootstrapped, the GitHub Actions workflow processes every commit automatically, and the RAG quality gate (eval harness) certifies the store works.

### Added

**`chronicle quickstart` — interactive setup wizard**
- Guides a new user from zero to a working `.lore/` in ~5 minutes
- Steps: git repo check → `chronicle init` → `chronicle migrate` → `chronicle hooks install` → `chronicle setup` → next-steps summary
- `--yes` flag for unattended/CI mode

**`chronicle migrate` — schema migration command**
- Upgrades `.lore/` stores from any prior schema version to current (v1→v5)
- Idempotent — safe to run multiple times
- Migrations covered: `index.md` creation (v2), `.extraction-cache.json` rename (v3), `low-confidence.md` creation (v4), evolution era deduplication (v5)

**`chronicle decision` — decision lifecycle management**
- `chronicle decision list` — display all decisions with current lifecycle status tags
- `chronicle decision deprecate "<title>"` — mark a decision as deprecated (adds `<!-- status:deprecated -->` tag)
- `chronicle decision supersede "<title>" --by "<new>"` — mark as superseded with forward reference
- `chronicle decision promote "<title>"` — lift a low-confidence decision into the main `decisions.md`

**`chronicle verify` fix — trivial commit exclusion**
- `verify` now uses `getCommits()` scanner (same filters as `init`) so `chore`, `docs`, and lockfile commits are not counted as "unprocessed" — prevents false-positive staleness alerts in CI

### Changed

- `chronicle eval --init` bootstraps eval cases from existing decisions and rejections (was previously empty)
- `chronicle inject` filters deprecated/superseded decisions from the output by default (lifecycle-aware injection)
- Internal: `findLoreRoot` test isolation via temp-dir rename pattern (CI reliability)

### Tests

- Total: 223+ tests passing across 10 suites
- Self-dogfood: `chronicle eval` on Chronicle's own `.lore/` — all 4 KPIs pass (100% recall, 100% rejection hit, MRR=1.000, 0% false confidence)

---

## [0.13.0] — 2026-04-12

### Added

**Pipeline integration tests** (#42)
- `process --dry-run` tests: verifies commit counting against a real git repo with `MIN_DIFF_LINES`-compliant commits
- `inject → doctor → verify` chain: full downstream pipeline with pre-built `.lore/` fixture, no LLM calls needed
- `chronicle search` tests: keyword fallback with `--text` flag, `--json`, exit code coverage

**`chronicle search` defaults to hybrid semantic mode** (#47)
- Hybrid search (α=0.7 semantic + 0.3 keyword) is now the default when `@huggingface/transformers` is installed
- Silently falls back to keyword search when transformers are not available (`semanticSearch` returns null)
- New `--text` flag forces keyword-only mode
- `--semantic` flag preserved for pure vector similarity mode

**`chronicle doctor` — 3 new integrity checks** (#43)
- Check 7: orphaned ADR detection — warns when `.lore/decisions/` files are not linked from `decisions.md`
- Check 8: evolution integrity — detects the corruption pattern where all eras show identical decision counts
- Check 9: `process.log` bounds — warns when log exceeds 500 lines

**`chronicle process` — bounded log** (#46)
- `process.log` is auto-truncated to 500 lines after each run (keeps tail, discards oldest entries)
- `truncateLog()` utility at end of `process.ts`

**`chronicle init` generates `index.md`** (#41)
- Reads `package.json` (walks up 2 levels) for name, description, version
- Generates structured `index.md` with Key Constraints and Architecture template sections
- `chronicle inject` warns on stderr when `index.md` is missing

### Fixed

**`evolution.md` era deduplication** (#40)
- `getDecisionsInRange()` used inclusive lower bound — same-date decisions flooded all eras sharing that date
- Fix: genesis era keeps `date >= from`; all later eras use `date > from` (exclusive)
- Row filter changed from `!l.includes('Decision')` (broke when titles contained "Decision") to checking first table cell specifically

### Tests

- New pipeline integration tests in `cli-smoke.test.ts` — 14 new tests across 3 describe blocks
- Evolution regression: "does not repeat same-date decisions across multiple same-day eras"
- Doctor integrity checks: 6 new tests (orphaned ADRs, evolution corruption, process.log bounds)
- Total: 223 tests passing

---

## [0.12.0] — 2026-04-12

### Added

**`chronicle status` command**
- Single-line health summary: `◆ chronicle │ N decisions · N rejected · N ADRs · N sessions │ ✓ N unprocessed`
- Shows `· N low-confidence` and `· ⚠ N extraction errors` when non-zero
- `--json` flag for machine-readable output (CI, scripting, status bars)

**Decision DAG — Mermaid renderer (`chronicle relate --diagram`)**
- `buildMermaidDAG(graph)` renders the full decision relation graph as a `flowchart TD` Mermaid block
- Labeled edges: `depends-on` (solid), `supersedes` (dashed), `related-to` (dotted)
- Sanitizes double-quotes in decision titles; handles all edge types and isolated nodes

**Confidence threshold filtering (`chronicle process --min-confidence`)**
- `--min-confidence <n>` (default `0.5`) — decisions below threshold are quarantined to `.lore/low-confidence.md` rather than discarded or silently accepted
- "Preserve but quarantine" pattern: low-confidence results remain reviewable
- `.lore/low-confidence.md` added to store structure (`STORE_FILES` map in `@chronicle/core`)
- `chronicle status` surfaces low-confidence count

**Extraction error tracking**
- `callWithRetry` accepts an optional `ctx: { errors: number }` ref threaded through concurrent batches
- On exhaustion (3 failed attempts), `ctx.errors` is incremented — distinguishes "no decisions found" from "LLM returned malformed JSON"
- `chronicle process` passes `extractionCtx` and logs `errors:N` to `.lore/process.log`
- `chronicle status` reads the last log entry and surfaces extraction errors

**GitHub Actions job summary**
- `chronicle.yml` writes a markdown table to `$GITHUB_STEP_SUMMARY` after each `chronicle process` run
- Table shows: decisions, rejections, ADRs, sessions, unprocessed commits, low-confidence, extraction errors

### Changed

- `evolution` eras now sort decisions by risk level (high → medium → low) before rendering
- `renderEvolutionMarkdown` hides the "Most changed files" section when decisions exist — file churn is noise when decisions tell the story
- `getDecisionsInRange` now correctly filters by date range; handles both legacy format (title in col[0]) and current format (date in col[0])
- `chronicle inject` uses the two most-recent evolution eras (previously used the oldest era)

### Fixed

- Removed `'two-pass'` from `ExtractionStrategy` type — it was typed as valid but threw `"not implemented"` at runtime
- `chronicle status` crash: `'low-confidence'` was missing from `STORE_FILES` map, causing `lorePath(root, undefined)` at runtime

### Tests

- New `semantic-search.test.ts` — 7 tests covering null embed fallback, empty corpus, hybrid mode, `buildEmbeddingIndex`
- New `cli-smoke.test.ts` freshness block — 3 tests: unprocessed detection, cache-hit zero, exit-1 on lag
- `callWithRetry` ctx tests — 6 new tests: success, empty `[]`, retry-then-succeed, exhaustion increments ctx, `[]` does not increment ctx, accumulation across batches
- `evolution.test.ts` — 4 new tests: risk ordering, keyFiles suppression when decisions exist, keyFiles shown when no decisions, date-range filtering
- Total: 202 tests passing

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
- Two-pass extraction (cheap LLM filter → quality model for complex decisions) — deferred until confidence gating is stable

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

[Unreleased]: https://github.com/ypollak2/chronicle/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/ypollak2/chronicle/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/ypollak2/chronicle/compare/v0.13.0...v1.0.0
[0.13.0]: https://github.com/ypollak2/chronicle/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/ypollak2/chronicle/compare/v0.9.1...v0.12.0
[0.9.1]: https://github.com/ypollak2/chronicle/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/ypollak2/chronicle/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/ypollak2/chronicle/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/ypollak2/chronicle/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/ypollak2/chronicle/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/ypollak2/chronicle/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/ypollak2/chronicle/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/ypollak2/chronicle/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ypollak2/chronicle/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ypollak2/chronicle/releases/tag/v0.1.0
