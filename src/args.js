import { parseArgs as nodeParseArgs } from 'util';
import path from 'path';
import fs from 'fs';
import { prompt } from './prompt.js';

// Priority: CLI flag → env var → .env file → interactive prompt
// Env var names: WP_URL, WP_USER, WP_PASS

const ARG_OPTIONS = {
  url:         { type: 'string' },
  user:        { type: 'string' },
  pass:        { type: 'string' },
  headless:    { type: 'boolean', default: true },
  json:        { type: 'boolean', default: false },
  'keep-page': { type: 'boolean', default: false },
  concurrency: { type: 'string',  default: '4' },
  width:       { type: 'string',  default: '1280' },
  height:      { type: 'string',  default: '800' },
};

/**
 * Parse a .env file and populate process.env for any keys not already set.
 * Supports KEY=value, KEY="value", KEY='value', and # comments.
 * Silently skips if no .env file exists.
 */
function loadDotEnv() {
  const envPath = path.join(process.cwd(), '.env');
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // No .env — that's fine
  }
}

export async function parseArgs(args) {
  loadDotEnv();

  const { values, positionals } = nodeParseArgs({
    args,
    options: ARG_OPTIONS,
    allowPositionals: true,
  });

  // Resolve URL: CLI → env → prompt
  let url = values.url ?? process.env.WP_URL;
  if (!url) {
    url = await prompt('WordPress URL (e.g. http://site.test): ');
    if (!url) throw new Error('WordPress URL is required.');
  }

  // Resolve user: CLI → env → prompt
  let user = values.user ?? process.env.WP_USER;
  if (!user) {
    user = await prompt('WordPress admin username: ');
    if (!user) throw new Error('WordPress username is required.');
  }

  // Resolve pass: CLI → env → prompt (hidden)
  let pass = values.pass ?? process.env.WP_PASS;
  if (!pass) {
    pass = await prompt('WordPress admin password: ', { hidden: true });
    if (!pass) throw new Error('WordPress password is required.');
  }

  return {
    url:         url.replace(/\/$/, ''),
    user,
    pass,
    headless:    values.headless,
    json:        values.json,
    keepPage:    values['keep-page'],
    concurrency: Math.max(1, parseInt(values.concurrency, 10)),
    viewport: {
      width:  parseInt(values.width,  10),
      height: parseInt(values.height, 10),
    },
    files: positionals,
  };
}

export function resolveFiles(filePaths) {
  if (!filePaths || filePaths.length === 0) {
    throw new Error(
      'No pattern files specified.\n' +
      'Usage: sentinel path/to/patterns/\n' +
      'Credentials: set WP_URL, WP_USER, WP_PASS in .env or pass as --url/--user/--pass flags.'
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
