# Changelog

All notable changes to Chronicle are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

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
- Phase 4: Tool adapters (Cursor `.cursorrules`, Aider `--read`, Gemini `GEMINI.md`, Copilot instructions)
- Phase 5: Mermaid diagram auto-generation (architecture, dependency graph, evolution timeline)
- Phase 6: Evolution records and system milestone timeline
- Phase 7 (v2): Semantic clustering extraction strategy (group commits by file overlap + time proximity)
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
