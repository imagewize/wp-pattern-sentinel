import { parseArgs as nodeParseArgs } from 'util';
import path from 'path';
import fs from 'fs';
import { prompt } from './prompt.js';
import { findTrellisDir, loadTrellisCredentials } from './trellis.js';

/**
 * Credential resolution priority:
 *   1. --trellis flag  → reads Roots Trellis vault + wordpress_sites.yml
 *   2. CLI flags       → --url, --user, --pass
 *   3. Env vars        → WP_URL, WP_USER, WP_PASS
 *   4. .env file       → loaded from cwd automatically
 *   5. Interactive     → prompted if still missing (password is masked)
 */

const ARG_OPTIONS = {
  // Credentials
  url:           { type: 'string' },
  user:          { type: 'string' },
  pass:          { type: 'string' },
  // Trellis integration
  trellis:       { type: 'boolean', default: false },
  'trellis-dir': { type: 'string' },
  site:          { type: 'string' },
  env:           { type: 'string',  default: 'development' },
  subsite:       { type: 'string' },
  // Bedrock / WP core subdir (e.g. "wp" for Bedrock installs where core lives at /wp/)
  // Auto-detected via WP_SITEURL when --trellis is used; set manually otherwise.
  'wp-subdir':   { type: 'string' },
  // Behaviour
  headless:      { type: 'boolean', default: true },
  json:          { type: 'boolean', default: false },
  'keep-page':   { type: 'boolean', default: false },
  concurrency:   { type: 'string',  default: '4' },
  width:         { type: 'string',  default: '1280' },
  height:        { type: 'string',  default: '800' },
  // Persistence
  cache:         { type: 'boolean', default: false },
  'clear-cache': { type: 'boolean', default: false },
  log:           { type: 'boolean', default: false },
};

/**
 * Parse a .env file and add any keys not already in process.env.
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

  let url, adminUrl, user, pass;

  // --- Source 1: Trellis vault ---
  if (values.trellis) {
    const trellisDir = values['trellis-dir']
      ? path.resolve(values['trellis-dir'])
      : findTrellisDir();

    ({ url, adminUrl, user, pass } = loadTrellisCredentials({
      trellisDir,
      site:    values.site,
      env:     values.env,
      subsite: values.subsite ?? null,
    }));

  } else {
    // --- Source 2: CLI flags ---
    url  = values.url;
    user = values.user;
    pass = values.pass;

    // --- Source 3+4: Env vars / .env file ---
    url  ??= process.env.WP_URL;
    user ??= process.env.WP_USER;
    pass ??= process.env.WP_PASS;

    // --- Source 5: Interactive prompt ---
    if (!url) {
      url = await prompt('WordPress URL (e.g. http://site.test): ');
      if (!url) throw new Error('WordPress URL is required.');
    }
    if (!user) {
      user = await prompt('WordPress admin username: ');
      if (!user) throw new Error('WordPress username is required.');
    }
    if (!pass) {
      pass = await prompt('WordPress admin password: ', { hidden: true });
      if (!pass) throw new Error('WordPress password is required.');
    }

    // --wp-subdir: manually specify the WP core subdir (e.g. "wp" for Bedrock)
    const wpSubdir = values['wp-subdir'];
    adminUrl = wpSubdir
      ? `${url.replace(/\/$/, '')}/${wpSubdir}`
      : url;
  }

  const cleanUrl      = url.replace(/\/$/, '');
  const cleanAdminUrl = (adminUrl ?? url).replace(/\/$/, '');

  return {
    url:         cleanUrl,
    adminUrl:    cleanAdminUrl,
    user,
    pass,
    headless:    values.headless,
    json:        values.json,
    keepPage:    values['keep-page'],
    cache:       values.cache,
    clearCache:  values['clear-cache'],
    log:         values.log,
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
      'Usage: sentinel [--trellis [--site=example.com]] path/to/patterns/\n' +
      'Or set WP_URL, WP_USER, WP_PASS in .env'
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
