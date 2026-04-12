# Chronicle — Architecture

> Living document. Updated as the system evolves.

## Purpose

Chronicle solves the **invisible layer problem**: code shows what exists, not what was tried, rejected, or decided. It captures architectural decisions during development and injects them back into future AI sessions as compressed context — without a vector database, without embeddings, without infrastructure.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CAPTURE LAYER                         │
│  git post-commit hook  •  MCP tools  •  CLI commands    │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                  PROCESSING LAYER                        │
│  @chronicle/core                                         │
│  scanner.ts → extractor.ts → cache.ts                   │
│  (cheap LLM: Haiku / Gemini Flash / GPT-4o-mini)        │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                   STORE LAYER (.lore/)                   │
│  Markdown files — git-tracked, human-readable            │
│  index.md • decisions.md • rejected.md • risks.md       │
│  decisions/ • sessions/ • diagrams/ • evolution.md      │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                 INJECTION LAYER                          │
│  chronicle inject → stdout pipe (any tool)              │
│  chronicle_get_context MCP tool (Claude Code)           │
│  Tool adapters: .cursorrules, GEMINI.md, etc.           │
└─────────────────────────────────────────────────────────┘
```

---

## Package Structure

```
chronicle/                        monorepo root
├── packages/
│   ├── core/                     @chronicle/core — pure logic, no CLI deps
│   │   └── src/
│   │       ├── store.ts          read/write .lore/ store
│   │       ├── scanner.ts        git log → CommitMeta[]
│   │       ├── extractor.ts      CommitMeta[] + LLM → ExtractionResult[]
│   │       ├── cache.ts          SHA-keyed JSON cache
│   │       ├── ranker.ts         relevance scoring for inject
│   │       ├── relations.ts      decision DAG (depends-on, supersedes, related-to)
│   │       ├── embeddings.ts     optional MiniLM-L6-v2 local embeddings
│   │       ├── semantic-search.ts hybrid keyword + vector search
│   │       ├── evolution.ts      git-tag era synthesis
│   │       ├── staleness.ts      file-mod staleness detection
│   │       ├── sources.ts        multi-source registry
│   │       ├── ingestor.ts       dir/url/pdf chunking → .lore/chunks/
│   │       └── index.ts          public API
│   │
│   ├── cli/                      chronicle-dev (PyPI) — the user-facing binary
│   │   └── src/
│   │       ├── cli.ts            commander entry point
│   │       ├── llm.ts            LLM provider adapters (gemini/anthropic/openai/ollama)
│   │       ├── format.ts         markdown/xml/plain formatters
│   │       ├── adapters/         tool adapter generators
│   │       └── commands/
│   │           ├── init.ts           chronicle init
│   │           ├── quickstart.ts     chronicle quickstart (setup wizard)
│   │           ├── migrate.ts        chronicle migrate (schema v1→v5)
│   │           ├── inject.ts         chronicle inject
│   │           ├── process.ts        chronicle process (CI batch)
│   │           ├── decision.ts       chronicle decision (lifecycle: deprecate/supersede/promote)
│   │           ├── deepen.ts         chronicle deepen
│   │           ├── verify.ts         chronicle verify (CI freshness gate)
│   │           ├── doctor.ts         chronicle doctor
│   │           ├── status.ts         chronicle status
│   │           ├── search.ts         chronicle search (hybrid)
│   │           ├── eval.ts           chronicle eval (RAG quality KPIs)
│   │           ├── relate.ts         chronicle relate (DAG)
│   │           ├── who.ts            chronicle who <file>
│   │           ├── context.ts        chronicle context add/remove/show
│   │           ├── graph.ts          chronicle graph (HTML topology)
│   │           ├── evolution.ts      chronicle evolution
│   │           ├── diagram.ts        chronicle diagram
│   │           ├── session.ts        chronicle session save/list/show/archive
│   │           ├── serve.ts          chronicle serve (local web viewer)
│   │           ├── setup.ts          chronicle setup --tool
│   │           ├── mcp.ts            chronicle mcp (MCP server entry point)
│   │           ├── add.ts            chronicle add --repo/--dir/--url/--pdf
│   │           ├── ingest.ts         chronicle ingest
│   │           ├── merge-driver.ts   chronicle merge-driver (git merge driver)
│   │           └── hooks.ts          chronicle hooks install/remove
│   │
│   ├── mcp/                      @chronicle/mcp — Claude Code native
│   │   └── src/server.ts         MCP server (6 tools)
│   │
│   └── python/                   chronicle-dev (PyPI)
│       └── chronicle/
│           ├── _cli.py           subprocess wrapper → Node binary
│           └── __init__.py
│
└── .github/workflows/
    ├── ci.yml                    test on every push/PR (Python 3.11–3.13)
    ├── release.yml               build + PyPI + GitHub Release on git tag
    └── chronicle.yml             auto-update .lore/ on every push to main
```

---

## The `.lore/` Store

```
.lore/
├── index.md              Project summary + key constraints (LLM-synthesized)
├── decisions.md          Lightweight table index of all decisions
├── decisions/            Deep ADR files (auto-triggered by complexity signals)
│   └── <slug>.md         One file per complex decision
├── rejected.md           What was tried and why it failed ← most valuable file
├── risks.md              High-blast-radius files + fragile areas
├── low-confidence.md     Quarantined extractions (confidence < threshold)
├── evolution.md          System milestone timeline
├── context.md            Business/product context (goals, constraints, team, stack)
├── ownership.md          File ownership overrides (supplements CODEOWNERS)
├── diagrams/             Mermaid diagrams (architecture, dependencies, timeline)
│   ├── architecture.txt
│   ├── dependencies.txt
│   └── evolution.txt
├── chunks/               Multi-source knowledge chunks
│   └── <sourceId>/
├── sessions/             Per-session AI summaries
│   ├── YYYY-MM-DD.md
│   └── _index.md         Compact table of all sessions
├── .eval.json            RAG quality eval cases (committed to repo)
└── .extraction-cache.json  SHA → ExtractionResult (gitignored)
```

### Immutability rules

| File | Write pattern | Reason |
|------|--------------|--------|
| `decisions.md` | Append-only rows | Never lose history |
| `decisions/*.md` | Write-once (new file per reversal) | Preserve full decision history |
| `rejected.md` | Append-only | Never lose rejections |
| `risks.md` | Overwrite on change | Current state matters more than history |
| `sessions/*.md` | One file per day, immutable | Session snapshots |

---

## Data Flow: Bootstrap (`chronicle init`)

```
chronicle init --depth=6months
      │
      ▼
scanner.getCommits(root, '6months')
      │  filters: no merges, no noise prefixes (chore/style/docs/test)
      │  enriches: diff, diffStat, tags
      │  filters: ≥20 changed lines
      ▼
CommitMeta[]
      │
      ▼
cache.has(sha) → skip already-processed commits
      │
      ▼
extractor.extractFromCommits(commits, llm, { strategy: 'simple' })
      │  batches: 6 commits or 5000 chars, whichever comes first
      │  sends: buildExtractionPrompt(batch) → cheap LLM
      │  parses: JSON response → ExtractionResult[]
      ▼
ExtractionResult[]
      │
      ├── isDecision + !isDeep  → row appended to decisions.md
      ├── isDecision + isDeep   → decisions/<slug>.md + row in decisions.md
      └── isRejection           → entry appended to rejected.md
```

## Data Flow: Live Capture (git hooks)

```
git commit
      │
      ▼
post-commit hook (async — non-blocking)
      │
      ▼
chronicle capture --from-commit HEAD
      │  gets last commit only
      │  checks cache — if hit, exits immediately
      ▼
same extraction flow as bootstrap (single commit batch)
      │
      └── appends to store files

git push
      │
      ▼
pre-push hook (synchronous — runs before remote receives anything)
      │
      ▼
chronicle process --quiet
      │  processes any commits the post-commit hook missed
      │  uses CHRONICLE_LLM env var (or auto-detects configured provider)
      │  no GitHub Actions secret needed — runs with local credentials
      │
      ├── if .lore/ changed:
      │     git add .lore/
      │     git commit -m "chore(lore): update .lore/ [skip ci]"
      │
      └── push proceeds — remote always receives fresh .lore/
```

This local-first approach means `.lore/` stays current on the remote without any CI secrets or GitHub Actions configuration.

## Data Flow: Injection (`chronicle inject`)

```
chronicle inject [--files=src/auth/] [--full]
      │
      ▼
always included:
  index.md          (~200 tokens)
  decisions.md      (table index, ~100 tokens)
  rejected.md       (compact, ~300 tokens)

conditionally included:
  risks.md          (scoped to --files if provided)
  decisions/*.md    (only ADRs matching --files, or all if --full)
  sessions/latest   (last session summary)
      │
      ▼
formatOutput(sections, format)   markdown | xml | plain
      │
      ▼
stdout → pipe into any AI tool
```

---

## Extraction Strategy Pattern

The `extractFromCommits` function uses a strategy pattern:

```typescript
// v1 (shipped): simple fixed batching
strategy: 'simple'    → batches of 6, ≤5000 chars

// v2 (shipped): semantic clustering
strategy: 'clustered' → group by file overlap + time proximity → richer rationale

// v3 (deferred): two-pass
// strategy: 'two-pass' → cheap LLM filter → quality model for complex decisions
//   deferred until confidence gating is stable
```

The strategy is a parameter to `extractFromCommits`. Callers don't change when strategies upgrade.

---

## Decision Lifecycle

Decisions move through lifecycle states tracked as inline HTML comment tags in `decisions.md`:

```
active (default) → deprecated  (use: chronicle decision deprecate "<title>")
                → superseded   (use: chronicle decision supersede "<title>" --by "<new>")

low-confidence.md → active     (use: chronicle decision promote "<title>")
```

`chronicle inject` filters deprecated and superseded decisions from output by default — AI sessions only see actionable knowledge.

---

## Eval Harness (RAG Quality Gate)

`chronicle eval` runs 4 KPIs against `.lore/.eval.json`:

| KPI | Target | What it measures |
|-----|--------|-----------------|
| Decision Recall | ≥ 80% | Do relevant decisions surface for known-relevant queries? |
| Rejection Hit Rate | ≥ 90% | Do rejection entries appear when querying that rejected approach? |
| Semantic MRR@5 | ≥ 0.70 | Does the right answer rank in the top 5? |
| False Confidence Rate | ≤ 10% | Does the store answer queries it should say "unknown" to? |

`chronicle eval --init` bootstraps eval cases from existing decisions/rejections — ready to run immediately. Exits 1 if any KPI misses target (suitable as a CI gate).

---

## LLM Provider Adapters

All providers implement the same `LLMProvider = (prompt: string) => Promise<string>` interface. New providers are added to `packages/cli/src/llm.ts` without touching extraction logic.

| Provider | Model used | Cost tier |
|----------|-----------|-----------|
| `anthropic` | claude-haiku-4-5-20251001 | cheap |
| `openai` | gpt-4o-mini | cheap |
| `gemini` | gemini-2.0-flash | cheap |

All use the cheapest available model — extraction is a classification task, not a reasoning task.

---

## MCP Integration (Claude Code)

The MCP server exposes Chronicle as native Claude Code tools. The AI calls them mid-session:

| Tool | When AI calls it |
|------|-----------------|
| `chronicle_get_context` | Auto: session start — injects compressed context |
| `chronicle_log_decision` | When making an architectural choice |
| `chronicle_log_rejection` | When abandoning an approach |
| `chronicle_get_risks` | Before touching a high-blast-radius file |
| `chronicle_save_session` | Auto: session end — writes session summary |
| `chronicle_get_status` | When checking store health during session |

---

## Multi-Tool Compatibility

The store is universal. Each tool gets a thin adapter:

| Tool | Adapter mechanism |
|------|------------------|
| Claude Code | MCP server + SessionStart/Stop hooks (`chronicle setup --tool=claude-code`) |
| Codex | `AGENTS.md` injection (`chronicle setup --tool=codex`) |
| Cursor | `.cursorrules` auto-generated (`chronicle setup --tool=cursor`) |
| Gemini CLI | `GEMINI.md` auto-generated (`chronicle setup --tool=gemini-cli`) |
| GitHub Copilot | `.github/copilot-instructions.md` (`chronicle setup --tool=copilot`) |
| Aider | `.aider.conf.yml` with `--read` entries (`chronicle setup --tool=aider`) |
| OpenCode / Trae / Factory | `chronicle inject \| <tool>` stdout pipe |
| Any tool | `chronicle inject` → stdout |

`chronicle setup --all` installs every adapter at once.

---

## Testing Strategy

| Layer | Framework | What's tested |
|-------|-----------|--------------|
| `@chronicle/core` | vitest | store CRUD, scanner noise filter, extractor batching + caching |
| `chronicle-dev` CLI | vitest (integration) | command outputs, hook installation |
| Python wrapper | pytest | Node detection, binary resolution, version |
| Release gate | GitHub Actions | All tests must pass before npm/PyPI publish |

Coverage threshold: 55% lines/functions, 48% branches (adjusted to exclude CLI entry points, stubs, and MCP server from coverage — these are integration-tested separately).

---

## Release Process

```
git tag v1.x.y && git push --tags
      │
      ▼
GitHub Actions: release.yml
      │
      ├── npm ci + npm run build           ← must succeed
      ├── npm test + Python pytest         ← must pass (release gate)
      ├── scripts/sync-python-version.js   ← syncs pyproject.toml from package.json
      ├── Bundle cli.js → Python wheel     ← single Node binary inside wheel
      ├── twine upload (PyPI)              ← chronicle-dev on PyPI
      └── softprops/action-gh-release      ← GitHub Release with wheel artifacts
```

**No npm publish** — the npm registry requires a paid org account. Chronicle distributes exclusively via PyPI (Python users) and GitHub Releases (direct download).

Version source of truth: `packages/cli/package.json`. `scripts/sync-python-version.js` propagates this to `packages/python/pyproject.toml` before each PyPI publish.

**Continuous `.lore/` updates**: `chronicle.yml` runs on every push to `main`, processes new commits through `chronicle process`, and commits updated `.lore/` files back with `[skip ci]`. Requires `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`) set as a GitHub repository secret.
