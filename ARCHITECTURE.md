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
│   │       └── index.ts          public API
│   │
│   ├── cli/                      chronicle-dev (npm)
│   │   └── src/
│   │       ├── cli.ts            commander entry point
│   │       ├── llm.ts            LLM provider adapters
│   │       ├── format.ts         markdown formatters
│   │       └── commands/
│   │           ├── init.ts       chronicle init
│   │           ├── inject.ts     chronicle inject
│   │           ├── deepen.ts     chronicle deepen
│   │           └── hooks.ts      chronicle hooks install/remove
│   │
│   ├── mcp/                      @chronicle/mcp — Claude Code native
│   │   └── src/server.ts         MCP server (5 tools)
│   │
│   └── python/                   chronicle-dev (PyPI)
│       └── chronicle/
│           ├── _cli.py           subprocess wrapper → Node binary
│           └── __init__.py
│
└── .github/workflows/
    ├── ci.yml                    test on every push/PR
    └── release.yml               publish npm + PyPI on git tag
```

---

## The `.lore/` Store

```
.lore/
├── index.md              Project summary + key constraints (LLM-written)
├── decisions.md          Lightweight table index of all decisions
├── decisions/            Deep ADR files (auto-triggered by complexity signals)
│   └── <slug>.md         One file per complex decision
├── rejected.md           What was tried and why it failed ← most valuable file
├── risks.md              High-blast-radius files + fragile areas
├── evolution.md          System milestone timeline
├── diagrams/             Mermaid diagrams (architecture, dependencies, timeline)
│   ├── architecture.mmd
│   ├── dependencies.mmd
│   └── evolution.mmd
├── sessions/             Per-session AI summaries
│   └── YYYY-MM-DD.md
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

## Data Flow: Live Capture (post-commit hook)

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
```

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

The `extractFromCommits` function uses a strategy pattern to keep v1 simple while reserving clean upgrade paths:

```typescript
// v1 (shipped): simple fixed batching
strategy: 'simple'    → batches of 6, ≤5000 chars

// v2 (planned): semantic clustering
strategy: 'clustered' → group by file overlap + time proximity

// v3 (planned): two-pass
strategy: 'two-pass'  → cheap LLM filter → quality model for complex decisions
```

The strategy is a parameter to `extractFromCommits`. Callers don't change when strategies upgrade.

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
| `chronicle_get_context` | Auto: session start |
| `chronicle_log_decision` | When making an arch choice |
| `chronicle_log_rejection` | When abandoning an approach |
| `chronicle_get_risks` | Before touching a high-risk file |
| `chronicle_save_session` | Auto: session end |

---

## Multi-Tool Compatibility

The store is universal. Each tool gets a thin adapter:

| Tool | Adapter mechanism |
|------|------------------|
| Claude Code | MCP server + hooks |
| Codex / any CLI | `chronicle inject \| <tool>` stdout pipe |
| Cursor | `.cursorrules` (generated, Phase 4) |
| Gemini CLI | `GEMINI.md` (generated, Phase 4) |
| Aider | `--read .lore/index.md` (Phase 4) |
| GitHub Copilot | `.github/copilot-instructions.md` (Phase 4) |

---

## Testing Strategy

| Layer | Framework | What's tested |
|-------|-----------|--------------|
| `@chronicle/core` | vitest | store CRUD, scanner noise filter, extractor batching + caching |
| `chronicle-dev` CLI | vitest (integration) | command outputs, hook installation |
| Python wrapper | pytest | Node detection, binary resolution, version |
| Release gate | GitHub Actions | All tests must pass before npm/PyPI publish |

Coverage threshold: 70% lines/functions, 60% branches.

---

## Release Process

```
git tag v0.x.y && git push --tags
      │
      ▼
GitHub Actions: release.yml
      │
      ├── npm run test:all       ← must pass
      ├── npm run build          ← must succeed
      ├── npm publish (npm)      ← chronicle-dev
      └── twine upload (PyPI)    ← chronicle-dev
```

Versions are kept in sync across all packages manually. Single source of truth: root `package.json` version drives the release tag.
