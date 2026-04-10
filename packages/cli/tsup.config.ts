import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  outDir: 'dist',
  format: ['cjs'],
  outExtension: () => ({ js: '.js' }),  // force .js so Python launcher finds cli.js
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  splitting: false,   // single output file — easier to bundle in the Python wheel
  noExternal: [/.*/],  // bundle ALL deps — standalone binary for PyPI wheel
})
