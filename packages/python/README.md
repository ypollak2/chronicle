# chronicle-dev (Python)

> AI-native development memory — markdown RAG for every AI coding tool

This is the Python wrapper for [Chronicle](https://github.com/ypollak2/chronicle).
It delegates all work to the Node.js CLI (`chronicle-dev` on npm).

## Requirements

- Python ≥ 3.9
- Node.js ≥ 20 ([install](https://nodejs.org))

## Install

```bash
pip install chronicle-dev
```

## Usage

Identical to the npm version:

```bash
chronicle init                    # scan last 6 months of git history
chronicle inject | claude         # pipe context into Claude
chronicle inject | codex          # or Codex, Gemini CLI, Aider...
chronicle hooks install           # passive capture on every commit
chronicle deepen --depth=1year    # scan further back
```

## How it works

`pip install chronicle-dev` installs a `chronicle` entry point that:
1. Checks Node ≥ 20 is available
2. Delegates to `chronicle` (if globally installed) or `npx chronicle-dev`

The Node package is the source of truth. This wrapper exists so Python developers
can install Chronicle without switching to npm.

## Full docs

See [github.com/ypollak2/chronicle](https://github.com/ypollak2/chronicle)
