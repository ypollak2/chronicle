# Chronicle Roadmap

> Chronicle is evolving from a **decision-capture tool** into a **full multi-source RAG system** for AI coding tools — spanning multiple repositories, non-git knowledge sources, semantic retrieval, and a CI-native self-maintaining store.

Current stable release: **v0.9.0**

---

## Vision

Today Chronicle answers: *"what architectural decisions were made in this repo, and what context does the AI need to understand the codebase?"*

The roadmap answers: *"how does a repo maintain its own living knowledge base, automatically, at every commit, in a form that is maximally useful to every AI coding tool?"*

```
v0.9.0  ──▶  v0.9.1  ──▶  v0.10.0  ──▶  v0.11.0  ──▶  v1.0.0
intelli-    release      test         extraction    stability
gence       pipeline     coverage     hardening     & polish
layer       fix          & CLI tests  & prompts
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

---

## v0.9.1 — Release Pipeline Fix
> **Priority:** P0 — blocks all future releases

The Python package version has been frozen at `0.5.4`/`0.5.5` while the npm package advanced to `0.9.0`. PyPI rejects uploads with `400 Bad Request`. The root cause is no automated version sync between `package.json` and the Python package.

| # | Change | Effort |
|---|--------|--------|
| R1 | `scripts/sync-python-version.js` — reads root `package.json`, writes `pyproject.toml` and `__init__.py` | S |
| R2 | Add `prerelease` npm script that runs `sync-python-version` before tagging | S |
| R3 | Add version-sync step to `release.yml` CI workflow before PyPI publish | S |
| R4 | Add `chronicle verify` to CI workflow as a post-test gate | S |
| R5 | Bump Python version to `0.9.0` now (fix the backlog) | S |

**Acceptance criteria:**
- `npm version patch` (or any version bump) automatically propagates to Python package
- PyPI publish succeeds for v0.9.1
- `chronicle verify` runs in CI and gates PRs to main

---

## v0.10.0 — CLI Test Coverage
> **Priority:** P1 — completes the test pyramid

Core has 149 tests. CLI has zero automated tests. The CLI is the user-facing surface — command argument parsing, output formatting, exit codes, error messages. A broken CLI doesn't show up in core tests.

| # | Change | Effort |
|---|--------|--------|
| T1 | CLI smoke tests: `chronicle inject`, `chronicle relate`, `chronicle context`, `chronicle who` | M |
| T2 | CLI error path tests: missing `.lore/`, bad args, LLM failure | S |
| T3 | `chronicle verify` integration test (stale store → exit 1) | S |
| T4 | `chronicle process --dry-run` test | S |
| T5 | Coverage threshold: 80% for core, 60% for CLI | S |

**Test approach:** spawn `chronicle` as a child process against a temp fixture directory, assert stdout/stderr/exit code. No mocking of the full CLI — black-box integration.

---

## v0.11.0 — Extraction Hardening
> **Priority:** P1 — extraction quality directly determines RAG quality

The mock LLM tests pass, but real-world extraction is flaky: LLMs return malformed JSON ~15% of the time, the prompt doesn't give enough examples, and large diffs get truncated without signaling the LLM.

| # | Change | What it fixes | Effort |
|---|--------|--------------|--------|
| E1 | Few-shot examples in extraction prompt (3 worked examples) | LLM calibration — fewer "unsure" outputs | M |
| E2 | Retry with backoff on malformed JSON (up to 3 attempts) | Recovers from transient LLM failures gracefully | S |
| E3 | Structured output mode via JSON schema (OpenAI, Anthropic) | Eliminates JSON parse errors at source | M |
| E4 | Diff truncation signal — tell LLM "diff was truncated at 4000 chars" | LLM knows to extrapolate, not assume complete picture | S |
| E5 | Confidence calibration — post-process to normalize against commit size | Large commits currently get inflated confidence | S |

**New in v0.11.0:**
```bash
chronicle init --strict          # retry up to 3x on bad LLM output
chronicle eval --update          # update .eval.json with new ground truth
```

---

## v0.12.0 — Dashboard & Visibility
> **Priority:** P2 — developer experience and observability

`chronicle serve` exists but the visualization is basic. The decision DAG (added in v0.9.0) has no visual representation. Evolution timeline exists but lacks filtering.

| # | Change | Effort |
|---|--------|--------|
| D1 | `chronicle status` — one-line health summary: N decisions, N risks, N stale, last update | S |
| D2 | `chronicle serve` — add D3.js relation graph panel (shows `dependsOn`/`supersedes` edges) | L |
| D3 | `chronicle serve` — evolution timeline with clickable era markers | M |
| D4 | `chronicle serve` — context panel showing business context facts | S |
| D5 | `chronicle doctor` — flag decisions with no confidence score, orphaned ADRs | S |

**New in v0.12.0:**
```bash
chronicle status                 # ✓ 12 decisions · 3 risks · 2 stale · updated 2h ago
chronicle serve --open           # opens browser, relation graph panel available
```

---

## v0.13.0 — Team Collaboration
> **Priority:** P2 — multiplies value when multiple engineers use Chronicle

Chronicle is currently single-developer. Team features: PR annotations, author-scoped queries, notification integrations.

| # | Change | Effort |
|---|--------|--------|
| C1 | GitHub Actions PR annotation — post a comment listing decisions captured in the PR | M |
| C2 | `chronicle inject --author <email>` — filter decisions to a specific author | S |
| C3 | `chronicle who --team` — list all files and their CODEOWNERS coverage | S |
| C4 | `chronicle relate --affected-by <decision>` — who owns the files a decision affects | S |
| C5 | Slack webhook integration (optional): post summary when `.lore/` updates | M |

---

## v0.14.0 — Performance & Scale
> **Priority:** P3 — needed for large repos (>5000 commits)

| # | Change | Effort |
|---|--------|--------|
| P1 | Parallel extraction with configurable concurrency (already partially in place) | S |
| P2 | Streaming diff processing — don't buffer entire git log in memory | M |
| P3 | Incremental evolution rebuild — only reprocess commits since last run | M |
| P4 | SQLite cache backend (replaces JSON file cache for repos >1000 cached results) | M |
| P5 | `chronicle bench` — benchmark extraction speed, output tokens/sec | S |

---

## v1.0.0 — Stability & Polish
> **Milestone:** API stability + documentation + getting-started guide

- All public `@chronicle/core` exports are stable (no breaking changes without major version bump)
- Complete `chronicle --help` documentation for every command
- `chronicle quickstart` — interactive 5-minute setup wizard
- Performance benchmarks published in README
- Python `chronicle-dev` package reaches feature parity with npm CLI
- `chronicle migrate` — upgrade `.lore/` from older schema versions

**1.0.0 acceptance criteria:**
- [ ] All 9 test suites pass with ≥80% coverage on core, ≥60% on CLI
- [ ] `chronicle verify` passes on the Chronicle repo itself
- [ ] Getting-started guide: zero to first `chronicle inject` in under 5 minutes
- [ ] Python PyPI package version synced with npm

---

## Architecture Evolution

```
v0.9.0 (current)              v1.0.0 (target)
──────────────────            ──────────────────────────────────────
.lore/                        .lore/
├── decisions.md              ├── decisions.md     ← relations + author
├── rejected.md               ├── rejected.md
├── risks.md                  ├── risks.md         ← owner field
├── evolution.md              ├── evolution.md
├── context.md       ← NEW    ├── context.md       (stable)
├── sessions/                 ├── sessions/
├── decisions/       ← NEW    ├── decisions/       (deep ADRs)
│   └── *.md (ADRs)           │   └── *.md
├── chunks/                   ├── chunks/          (non-git sources)
├── sources.json              ├── sources.json
├── process.log      ← NEW    ├── process.log
├── .vectors.json             ├── .vectors.json
├── .eval.json                ├── .eval.json
└── .extraction-cache.json    └── .extraction-cache.json (or SQLite)
```

---

## Contributing to the Roadmap

Each roadmap item maps to a task in the project task tracker with:
- Full acceptance criteria
- File-level implementation details
- Dependency ordering

See [CHANGELOG.md](./CHANGELOG.md) for what's shipped.
File issues or PRs at [github.com/ypollak2/chronicle](https://github.com/ypollak2/chronicle).
