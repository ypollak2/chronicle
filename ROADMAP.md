# Chronicle Roadmap

> Chronicle is evolving from a **decision-capture tool** into a **full multi-source RAG system** for AI coding tools — spanning multiple repositories, non-git knowledge sources, and semantic retrieval.

Current stable release: **v0.5.5**

---

## Vision

Today Chronicle answers: *"what architectural decisions were made in this repo?"*

The roadmap answers: *"what does every AI coding tool need to know about this entire product — its code, its docs, its rejected ideas, its constraints — to make correct decisions on the first attempt?"*

```
v0.5.x  ──▶  v0.6.x  ──▶  v0.7.x  ──▶  v0.8.x  ──▶  v0.9.x
decision    quality       semantic      multi-source   intelligence
capture     & ranking     search        ingestion      layer
```

---

## v0.6.0 — Close the Gaps
> **Status:** 🔨 In progress

Fixes fundamental quality issues in the current system before adding new capabilities.

| # | Change | What it fixes | Effort |
|---|--------|--------------|--------|
| G1 | Timestamps in `decisions.md` table | LLMs can't reason about recency | S |
| G2 | Confidence scores on extraction | Binary yes/no causes noise from borderline commits | S |
| G3 | Relevance-ranked `inject` with `--top` / `--tokens` | Equal-weight concatenation buries important decisions | M |
| G4 | Session summarization (`chronicle session summarize`) | Only last session is ever injected; all prior context lost | M |
| G5 | Staleness detection and `⚠️` annotation | 2-year-old decisions treated same as yesterday's | M |
| G6 | Configurable graph cluster depth + monorepo awareness | All files under a path collapse to one graph node | S |

**New flags in v0.6.0:**
```bash
chronicle inject --top 20                # top 20 most relevant decisions
chronicle inject --tokens 4000           # auto-trim to fit token budget
chronicle inject --min-confidence 0.7    # filter low-confidence extractions
chronicle session summarize              # produce rolling _index.md
chronicle graph --depth 3                # module-level granularity
chronicle doctor                         # now reports stale decisions
```

---

## v0.7.0 — Semantic Layer
> **Status:** 📋 Planned (requires v0.6.0)

Adds local vector embeddings and semantic retrieval. No external API, no Docker — a 22MB model runs fully offline via `@xenova/transformers`.

| # | Change | What it enables | Effort |
|---|--------|----------------|--------|
| S1 | Local embedding engine (`@xenova/transformers`, MiniLM-L6-v2) | Foundation for all semantic features | M |
| S2 | Semantic search (`--semantic`, `--hybrid`) | Natural language queries instead of regex | S |
| S3 | Semantic inject ranking | Relevance-scored context instead of heuristic ordering | S |
| S4 | Incremental vector index (auto-updated by post-commit hook) | Index stays current without full rebuilds | M |
| KPI | `chronicle eval` command with RAG quality harness | Measure and track retrieval quality over time | M |

**New in v0.7.0:**
```bash
chronicle search "why did we choose postgres" --semantic
chronicle search "auth" --hybrid              # regex + semantic combined
chronicle inject --files src/auth/ --tokens 3000  # semantically ranked
chronicle reindex                             # rebuild vector index
chronicle eval                               # run KPI suite, exit 1 if failing
chronicle eval init                          # bootstrap test cases from .lore/
```

**KPI targets (`chronicle eval`):**

| Metric | Target | How measured |
|--------|--------|-------------|
| Decision Recall | ≥ 80% | LLM answers vs. ground truth in `.lore/.eval.json` |
| Rejection Hit Rate | ≥ 90% | Known-rejected patterns planted in test prompts |
| Context Relevance | ≥ 0.65 cosine | Injected chunks vs. manually labelled ideal set |
| Semantic MRR@5 | ≥ 0.70 | 30 test queries, rank of correct result |
| False Confidence Rate | ≤ 10% | Stale decisions without `⚠️` annotation |

---

## v0.8.0 — Multi-Source Ingestion
> **Status:** 📋 Planned (requires v0.7.0)

The largest structural change. Chronicle becomes the knowledge layer for an entire **product** spanning multiple repos and non-git sources.

| # | Change | What it enables | Effort |
|---|--------|----------------|--------|
| M1 | Source abstraction layer + `sources.json` config | Foundation for all multi-source features | L |
| M2 | Multi-repo federation (`chronicle add --repo`) | Unified knowledge base across N repos | L |
| M3 | Non-git ingestion (`--file`, `--dir`, `--url`, PDF, DOCX) | Architecture docs, PRDs, web pages as knowledge | L |
| M4 | Unified search across all sources | Single query across git + docs + web | S |
| M5 | `decisions.md` git merge driver | Clean auto-merge when branches both add decisions | M |

**New in v0.8.0:**
```bash
# Multi-repo
chronicle add --repo ../mobile-app --label mobile
chronicle add --repo ../backend --label backend
chronicle sources list                    # status of all sources

# Non-git sources
chronicle add --file ./docs/architecture.md --label arch
chronicle add --dir ./docs/ --label "all docs"
chronicle add --url https://... --label "API spec"
chronicle sources refresh arch            # re-fetch and re-index

# Scoped inject and search
chronicle inject --sources main,mobile    # two repos only
chronicle inject --sources all            # everything
chronicle search "auth flow" --sources mobile,arch

# Merge driver
chronicle hooks install --merge-driver    # never conflict on decisions.md again
```

**`.lore/sources.json`** (committed, shared with team):
```json
{
  "sources": [
    { "id": "main",    "type": "git", "uri": ".",             "label": "Core API" },
    { "id": "mobile",  "type": "git", "uri": "../mobile-app", "label": "iOS App" },
    { "id": "arch",    "type": "dir", "uri": "./docs/arch",   "label": "Architecture docs" },
    { "id": "prd",     "type": "url", "uri": "https://...",   "label": "Product spec" }
  ]
}
```

**`decisions.md` gains `source` column:**
```
| date       | source | author | title                    | affects     | risk   |
| 2024-03-10 | main   | alice  | Chose PostgreSQL         | src/db/     | low    |
| 2024-04-15 | mobile | bob    | Switched to offline-first| ios/store/  | high   |
```

---

## v0.9.0 — Intelligence Layer
> **Status:** 📋 Planned (requires v0.8.0)

Adds reasoning capabilities: decision relationships, product context, and ownership.

| # | Change | What it enables | Effort |
|---|--------|----------------|--------|
| I1 | Decision relationship DAG (`dependsOn` / `supersedes`) | Trace cascading effects; surface foundational decisions | L |
| I2 | Business/product context layer (`chronicle context add`) | OKRs, personas, constraints — the non-git product knowledge | M |
| I3 | Ownership tracking (author per decision, owner per module) | LLMs can direct questions to the right person | S |

**New in v0.9.0:**
```bash
# Product context (non-technical decisions)
chronicle context add --type constraint --text "Must support IE11 until Q1 2027"
chronicle context add --type goal --text "Reduce time-to-first-value < 5 minutes"
chronicle context add --type persona --file ./docs/user-personas.md
chronicle context add --type prd --file ./docs/Q3-PRD.md
chronicle context list

# Inject includes product layer
chronicle inject --product          # add product constraints + goals
chronicle inject --all              # everything: git + sources + product

# Cascade through decision dependencies
chronicle inject --files src/auth/ --with-deps   # includes upstream decisions
```

**Decision DAG in web UI** (`chronicle serve`):
- Hierarchical D3 tree view showing decision dependencies
- Foundational nodes highlighted (many things depend on them, nothing they depend on)
- Click a node → see what it blocks and what it depends on

---

## What's Currently Stable (v0.5.5)

| Capability | Status |
|------------|--------|
| Git history scanning with configurable depth | ✅ |
| LLM extraction (decisions, rejections, risk levels, deep ADRs) | ✅ |
| SHA-keyed extraction cache (incremental, resumable) | ✅ |
| `chronicle inject` — pipe context to any AI tool | ✅ |
| Post-commit hook (async, non-blocking) | ✅ |
| MCP server (6 tools for Claude Code) | ✅ |
| Adapters for 10+ AI tools | ✅ |
| `chronicle serve` — web viewer (Obsidian design) | ✅ |
| Evolution timeline (tag-based + time-based fallback) | ✅ |
| Module dependency graph | ✅ |
| `chronicle search` — full-text regex | ✅ |
| `chronicle doctor` — health checks | ✅ |

---

## Architecture Evolution

```
v0.5.x (current)              v0.8.x (target)
──────────────────            ──────────────────────────────────────
.lore/                        .lore/
├── decisions.md              ├── decisions.md     ← date+source+author
├── rejected.md               ├── rejected.md
├── risks.md                  ├── risks.md         ← owner field
├── evolution.md              ├── evolution.md
├── sessions/                 ├── sessions/
└── .extraction-cache.json    ├── product/         ← NEW: OKRs, personas
                              │   ├── constraints.md
                              │   ├── goals.md
                              │   └── personas.md
                              ├── chunks/          ← NEW: non-git source chunks
                              │   ├── arch/
                              │   └── prd/
                              ├── sources.json     ← NEW: multi-source registry
                              ├── .vectors.json    ← NEW: local embedding index
                              ├── .eval.json       ← NEW: KPI test cases
                              └── .extraction-cache.json
```

---

## Contributing to the Roadmap

Each roadmap item maps to a task in the project task tracker with:
- Full acceptance criteria
- File-level implementation details
- Dependency ordering

See [CHANGELOG.md](./CHANGELOG.md) for what's shipped.
File issues or PRs at [github.com/ypollak2/chronicle](https://github.com/ypollak2/chronicle).
