import { parseArgs as nodeParseArgs } from 'util';
import path from 'path';
import fs from 'fs';

const ARG_OPTIONS = {
  url:         { type: 'string',  default: 'http://localhost' },
  user:        { type: 'string',  default: 'admin' },
  pass:        { type: 'string',  default: 'password' },
  headless:    { type: 'boolean', default: true },
  json:        { type: 'boolean', default: false },
  'keep-page': { type: 'boolean', default: false },
  concurrency: { type: 'string',  default: '4' },
  width:       { type: 'string',  default: '1280' },
  height:      { type: 'string',  default: '800' },
};

export function parseArgs(args) {
  const { values, positionals } = nodeParseArgs({
    args,
    options: ARG_OPTIONS,
    allowPositionals: true,
  });

  return {
    url:         values.url.replace(/\/$/, ''),
    user:        values.user,
    pass:        values.pass,
    headless:    values.headless,
    json:        values.json,
    keepPage:    values['keep-page'],
    concurrency: Math.max(1, parseInt(values.concurrency, 10)),
    viewport: {
      width:  parseInt(values.width, 10),
      height: parseInt(values.height, 10),
    },
    files: positionals,
  };
}

export function resolveFiles(filePaths) {
  if (!filePaths || filePaths.length === 0) {
    throw new Error(
      'No pattern files specified.\n' +
      'Usage: sentinel --url=http://site.test --user=admin --pass=secret path/to/patterns/'
    );
  }

  const resolved = [];

  for (const filePath of filePaths) {
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs)) {
      console.warn(`Warning: path not found — ${filePath}`);
      continue;
    }
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      resolved.push(...findPhpFiles(abs));
    } else {
      resolved.push(abs);
    }
  }

  return [...new Set(resolved)];
}

function findPhpFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findPhpFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.php')) {
      results.push(full);
    }
  }
  return results;
}
