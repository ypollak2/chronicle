import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  outDir: 'dist',
  format: ['esm'],
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  splitting: false,   // single output file — easier to bundle in the Python wheel
})
