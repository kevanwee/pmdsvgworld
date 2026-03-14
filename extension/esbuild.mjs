#!/usr/bin/env node
// Bundles the extension host code and the webview bundle separately.
import * as esbuild from 'esbuild';
import { argv } from 'process';

const watch = argv.includes('--watch');

// ── Extension host (Node target, vscode is external) ─────────────────────────
const extCtx = await esbuild.context({
  entryPoints:  ['src/extension.ts'],
  bundle:       true,
  outfile:      'dist/extension.js',
  external:     ['vscode'],
  format:       'cjs',
  platform:     'node',
  target:       'node20',
  sourcemap:    true,
});

// ── Webview bundle (browser target, no externals) ─────────────────────────────
const webCtx = await esbuild.context({
  entryPoints:  ['src/webview-entry.ts'],
  bundle:       true,
  outfile:      'dist/webview.js',
  format:       'iife',
  platform:     'browser',
  target:       'es2020',
  sourcemap:    true,
  // Alias src/ files from the project root
  alias: {
    '../src/config.js':       '../src/config.js',
    '../src/agent-world.js':  '../src/agent-world.js',
  },
  // esbuild will resolve these relative to the extension folder;
  // the actual project src/ lives one level up
  absWorkingDir: new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
});

if (watch) {
  await Promise.all([extCtx.watch(), webCtx.watch()]);
  console.log('Watching …');
} else {
  await Promise.all([extCtx.rebuild(), webCtx.rebuild()]);
  await Promise.all([extCtx.dispose(), webCtx.dispose()]);
  console.log('Build complete.');
}
