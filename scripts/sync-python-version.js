#!/usr/bin/env node
/**
 * Syncs the Python package version from root package.json.
 * Run before any release: `node scripts/sync-python-version.js`
 *
 * Updates:
 *   - packages/python/pyproject.toml  (version = "x.y.z")
 *   - packages/python/chronicle/__init__.py  (__version__ = "x.y.z")
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// Read version from CLI package (single source of truth — root package.json is workspace root, not published)
const pkg = JSON.parse(readFileSync(join(root, 'packages', 'cli', 'package.json'), 'utf8'))
const version = pkg.version
if (!version) {
  console.error('ERROR: no version found in root package.json')
  process.exit(1)
}

// Update pyproject.toml
const pyprojectPath = join(root, 'packages', 'python', 'pyproject.toml')
const pyproject = readFileSync(pyprojectPath, 'utf8')
const updatedPyproject = pyproject.replace(
  /^version = "[\d.]+"/m,
  `version = "${version}"`
)
writeFileSync(pyprojectPath, updatedPyproject)

// Update __init__.py
const initPath = join(root, 'packages', 'python', 'chronicle', '__init__.py')
const init = readFileSync(initPath, 'utf8')
const updatedInit = init.replace(
  /^__version__ = "[\d.]+"/m,
  `__version__ = "${version}"`
)
writeFileSync(initPath, updatedInit)

console.log(`✓  Python package version synced to ${version}`)
console.log(`   packages/python/pyproject.toml`)
console.log(`   packages/python/chronicle/__init__.py`)
