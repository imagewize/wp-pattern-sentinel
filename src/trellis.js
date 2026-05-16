import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';

/**
 * Walk up from startDir looking for a directory that contains group_vars/
 * (the Trellis signature). Checks both the dir itself and a trellis/ subdir.
 */
export function findTrellisDir(startDir = process.cwd()) {
  let dir = path.resolve(startDir);

  for (let i = 0; i < 10; i++) {
    // Direct match (we're already inside the trellis dir)
    if (fs.existsSync(path.join(dir, 'group_vars'))) return dir;

    // Sibling trellis/ directory
    const sibling = path.join(dir, 'trellis');
    if (fs.existsSync(path.join(sibling, 'group_vars'))) return sibling;

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    'Could not find Trellis directory (looking for group_vars/ marker).\n' +
    'Run sentinel from inside your project, or pass --trellis-dir=/path/to/trellis.'
  );
}

/**
 * Try to match the current working directory against a site's local_path
 * to auto-select which site to validate. Returns the site key or null.
 *
 * local_path in wordpress_sites.yml is relative to the trellis directory.
 */
function detectSiteFromCwd(trellisDir, sites) {
  const cwd = process.cwd();
  for (const [key, config] of Object.entries(sites)) {
    if (!config.local_path) continue;
    const abs = path.resolve(trellisDir, config.local_path);
    if (cwd.startsWith(abs)) return key;
  }
  return null;
}

/**
 * Load credentials from Trellis vault and wordpress_sites.yml.
 *
 * Options:
 *   trellisDir  — absolute path to the trellis directory
 *   site        — site key, e.g. "demo.imagewize.com" (auto-detected if omitted)
 *   env         — "development" | "staging" | "production" (default: "development")
 *   subsite     — multisite subsite slug appended to the URL (e.g. "store")
 *
 * Returns { url, user, pass }
 */
export function loadTrellisCredentials({ trellisDir, site, env = 'development', subsite = null }) {
  const vaultFile     = path.join(trellisDir, 'group_vars', env, 'vault.yml');
  const vaultPassFile = path.join(trellisDir, '.vault_pass');
  const sitesFile     = path.join(trellisDir, 'group_vars', env, 'wordpress_sites.yml');

  for (const [label, p] of [['Vault password file', vaultPassFile], ['Sites file', sitesFile]]) {
    if (!fs.existsSync(p)) throw new Error(`${label} not found: ${p}`);
  }

  // Decrypt vault with ansible-vault
  let vaultContent;
  try {
    vaultContent = execSync(
      `ansible-vault view --vault-password-file "${vaultPassFile}" "${vaultFile}"`,
      { cwd: trellisDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch (err) {
    throw new Error(`Failed to decrypt Trellis vault: ${err.message}`);
  }

  const vault = yaml.load(vaultContent);
  const sites = yaml.load(fs.readFileSync(sitesFile, 'utf8'));

  const vaultSites = vault.vault_wordpress_sites ?? {};
  const wordpressSites = sites.wordpress_sites ?? {};

  // Auto-detect site from cwd, then fall back to first site in the file
  const siteKey = site
    ?? detectSiteFromCwd(trellisDir, wordpressSites)
    ?? Object.keys(wordpressSites)[0];

  if (!vaultSites[siteKey]) {
    const available = Object.keys(vaultSites).join(', ');
    throw new Error(`Site "${siteKey}" not found in vault. Available: ${available}`);
  }
  if (!wordpressSites[siteKey]) {
    throw new Error(`Site "${siteKey}" not found in wordpress_sites.yml`);
  }

  const adminPassword = vaultSites[siteKey].admin_password;
  if (!adminPassword) {
    throw new Error(`No admin_password for "${siteKey}" in vault`);
  }

  // Build URL from canonical hostname + SSL setting
  const canonical = wordpressSites[siteKey].site_hosts[0].canonical;
  const ssl        = wordpressSites[siteKey].ssl?.enabled ?? false;
  const protocol   = ssl ? 'https' : 'http';
  const url        = subsite
    ? `${protocol}://${canonical}/${subsite}`
    : `${protocol}://${canonical}`;

  // Trellis admin username is always "admin" — not stored in the vault
  return { url, user: 'admin', pass: adminPassword };
}
