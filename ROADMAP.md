# Chronicle Roadmap

> Chronicle is evolving from a **decision-capture tool** into a **full multi-source RAG system** for AI coding tools — spanning multiple repositories, non-git knowledge sources, semantic retrieval, and a CI-native self-maintaining store.

Current stable release: **v0.12.0**

---

## Vision

Today Chronicle answers: *"what architectural decisions were made in this repo, and what context does the AI need to understand the codebase?"*

The roadmap answers: *"how does a repo maintain its own living knowledge base, automatically, at every commit, in a form that is maximally useful to every AI coding tool?"*

```
v0.12.0  ──▶  v0.13.0  ──▶  v0.14.0  ──▶  v1.0.0
current       core fixes    stability     production
              (P0/P1)       & tests       ready
```

---

## ✅ Shipped

| Version | Theme | Key deliverables |
|---------|-------|-----------------|
| v0.1.0 | Foundation | `chronicle init`, git scanning, LLM extraction, `chronicle inject` |
| v0.2.0 | CLI polish | `chronicle doctor`, `chronicle deepen`, MCP server |
| v0.3.0 | Evolution | `chronicle evolution`, time-based era synthesis, `chronicle serve` |
| v0.4.0 | Clustering | Semantic commit clustering, `chronicle diagram`, `chronicle graph` |
| v0.5.0 | Architecture | Deep ADRs, session tracking, hook enrichment |
| v0.6.0 | Quality | Timestamps, confidence scores, relevance ranking, staleness detection |
| v0.7.0 | Semantic | Local embeddings, semantic search, semantic inject ranking, `chronicle eval` |
| v0.8.0 | Multi-source | Federation, non-git ingestion, unified search, `decisions.md` merge driver |
| v0.9.0 | Intelligence | Decision DAG (`relate`), business context (`context`), ownership (`who`), `verify`, `process`, GitHub Actions workflow, 149-test suite |
| v0.12.0 | Quality | `chronicle status`, confidence threshold filtering, extraction error tracking, evolution risk sorting, CI job summary, 202-test suite |

---

## v0.13.0 — Core Fixes (P0/P1) — Active

> **Theme:** Make the self-maintaining RAG loop actually correct and verifiable.
> **Routing:** llm_code/moderate for logic fixes · llm_code/simple for config · llm_code/complex for integration tests

### Phase 1 — Blockers (sequential)

| # | Task | Route | Effort |
|---|------|-------|--------|
| [#40] | Fix `evolution.md` date filtering — `getDecisionsInRange()` shows identical decisions in all 16 eras | `code/moderate` | S |
| [#41] | Generate `index.md` during `chronicle init` — project summary + constraints; inject output has no frame without it | `code/moderate` | M |

> ⚠ **Breaking change in #40**: existing `evolution.md` files must be deleted and regenerated. Document in release notes.

### Phase 2 — Stability (parallelizable after Phase 1)

| # | Task | Route | Effort |
|---|------|-------|--------|
| [#42] | CLI integration tests — init→process→inject→verify as child process against temp git repo | `code/complex` | L |
| [#43] | Strengthen `doctor` — orphaned ADRs, evolution integrity check, process.log bounds warning | `code/moderate` | M |
| [#44] | Sync Python version in CI release pipeline — wire `sync-python-version.js` into `release.yml` | `code/simple` | S |

**Acceptance criteria for v0.13.0:**
- `chronicle evolution --regen` produces eras with era-specific decisions (not identical across all eras)
- `chronicle init` creates `index.md` in `.lore/` (or fails gracefully with a clear message if LLM call fails)
- CLI integration test suite covers init→inject pipeline end-to-end
- `pip install chronicle-dev` installs v0.13.0 (Python version synced)

---

## v0.14.0 — Quality & Polish (P2)

| # | Task | Route | Effort |
|---|------|-------|--------|
| [#45] | Scope containment — move web viewer, multi-source, tool adapters to parking lot | `auto/simple` | S |
| [#46] | Bound `process.log` at 500 lines | `code/simple` | S |
| [#47] | Semantic search as default in `chronicle search` (hybrid when embeddings available) | `code/complex` | M |

---

## Parking Lot — Deferred (post-1.0)

These features are real and valuable but require a stable core first. They are explicitly out of scope until v1.0.0 ships.

| Feature | Why deferred |
|---------|-------------|
| **`chronicle serve` web viewer** | Basic HTML with no search/graph; effort vs. value low while CLI output quality issues remain |
| **Multi-source ingestion** (repos, URLs, PDFs) | Inflates scope dramatically — version drift, re-index triggers, chunking strategies; git-native is the strong use case |
| **Tool adapters** (`.cursorrules`, `GEMINI.md`, Copilot, Aider auto-gen) | High maintenance burden per tool format change; `chronicle inject > .cursorrules` works today |
| **Team collaboration** (PR annotations, Slack webhooks, `--author` filter) | Multiplies value but requires stable solo workflow first |
| **Performance at scale** (streaming diff, SQLite cache, `chronicle bench`) | Needed for >5000-commit repos; premature for current user base |

---

## v1.0.0 — Stability & Polish

**Acceptance criteria:**
- All test suites pass with ≥80% coverage on core, ≥60% on CLI
- `chronicle verify` passes on the Chronicle repo itself
- Getting-started guide: zero to first `chronicle inject` in under 5 minutes
- Python PyPI package version synced with npm
- `chronicle migrate` — upgrade `.lore/` from older schema versions
- `chronicle quickstart` — interactive 5-minute setup wizard
- All public `@chronicle/core` exports stable (no breaking changes without major version bump)

---

## Future — Team & Scale

> **Priority:** Post-1.0 — multiplies value when multiple engineers use Chronicle

Chronicle is currently single-developer. Team features: PR annotations, author-scoped queries, notification integrations.

| # | Change | Effort |
|---|--------|--------|
| C1 | GitHub Actions PR annotation — post a comment listing decisions captured in the PR | M |
| C2 | `chronicle inject --author <email>` — filter decisions to a specific author | S |
| C3 | `chronicle who --team` — list all files and their CODEOWNERS coverage | S |
| C4 | `chronicle relate --affected-by <decision>` — who owns the files a decision affects | S |
| C5 | Slack webhook integration (optional): post summary when `.lore/` updates | M |

## Architecture Evolution

```
v0.12.0 (current)             v1.0.0 (target)
──────────────────            ──────────────────────────────────────
.lore/                        .lore/
├── index.md         ← MISSING ├── index.md        ← generated by init
├── decisions.md              ├── decisions.md
├── rejected.md               ├── rejected.md
├── risks.md                  ├── risks.md
├── evolution.md     ← BROKEN  ├── evolution.md    ← era-scoped decisions
├── low-confidence.md         ├── low-confidence.md
├── sessions/                 ├── sessions/
├── decisions/                ├── decisions/       (deep ADRs)
│   └── *.md (ADRs)           │   └── *.md
├── process.log               ├── process.log      ← bounded at 500 lines
└── .extraction-cache.json    └── .extraction-cache.json
```

---

## Contributing to the Roadmap

Each roadmap item maps to a task in the project task tracker with:
- Full acceptance criteria
- File-level implementation details
- Dependency ordering

See [CHANGELOG.md](./CHANGELOG.md) for what's shipped.
File issues or PRs at [github.com/ypollak2/chronicle](https://github.com/ypollak2/chronicle).
