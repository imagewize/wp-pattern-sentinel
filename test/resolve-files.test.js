import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveFiles } from '../src/args.js';

let root;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-resolve-'));
  const files = [
    'patterns/hero.php',
    'patterns/nested/cta.html',
    'patterns/readme.md',
    'node_modules/pkg/demo.html',
    'vendor/lib/index.php',
    '.git/hooks/sample.html',
    'patterns/node_modules/stray.php',
  ];
  for (const rel of files) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '');
  }
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

const rel = files => files.map(f => path.relative(root, f).split(path.sep).join('/')).sort();

test('folder scan collects .php and .html, skipping dependency and dot folders', () => {
  assert.deepEqual(rel(resolveFiles([root])), ['patterns/hero.php', 'patterns/nested/cta.html']);
});

test('a skipped folder passed explicitly is still scanned', () => {
  assert.deepEqual(rel(resolveFiles([path.join(root, 'vendor')])), ['vendor/lib/index.php']);
});

test('explicit file paths are kept and de-duplicated', () => {
  const hero = path.join(root, 'patterns/hero.php');
  assert.deepEqual(rel(resolveFiles([hero, path.join(root, 'patterns')])), ['patterns/hero.php', 'patterns/nested/cta.html']);
});
