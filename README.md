# wp-pattern-sentinel

Browser-based WordPress block pattern validator. Loads each pattern into the Gutenberg editor via Playwright, saves it, and checks for block validation errors and content mismatches.

## Why browser-based?

WordPress block validation is a JavaScript concern. The editor's `save()` function can inject styles, reorder CSS classes, and drop attributes in ways that PHP cannot replicate. Only a real browser can catch these errors.

## Credentials

Credentials are resolved in this order — the first match wins:

1. **`--trellis` flag** — reads directly from Roots Trellis vault + `wordpress_sites.yml`
2. **CLI flags** — `--url`, `--user`, `--pass`
3. **Environment variables** — `WP_URL`, `WP_USER`, `WP_PASS`
4. **`.env` file** — placed in the directory where you run sentinel
5. **Interactive prompt** — sentinel asks if nothing else is set (password is masked)

`.env` is git-ignored. Never commit real credentials.

---

## Roots Trellis integration

If your project uses [Roots Trellis](https://roots.io/trellis/), pass `--trellis` and sentinel reads everything it needs from the vault and `wordpress_sites.yml` — no manual credential setup required.

```bash
# Auto-detect site from cwd, use development env
sentinel --trellis path/to/patterns/

# Specify a site explicitly
sentinel --trellis --site=demo.imagewize.com path/to/patterns/

# Validate a multisite subsite
sentinel --trellis --site=demo.imagewize.com --subsite=store path/to/patterns/

# Staging or production vault
sentinel --trellis --env=staging --site=imagewize.com path/to/patterns/

# Explicit trellis directory (if auto-discovery fails)
sentinel --trellis --trellis-dir=/path/to/trellis path/to/patterns/
```

**Requirements:**
- `ansible-vault` installed (`brew install ansible` or `pip install ansible`)
- `trellis/.vault_pass` present (standard Trellis setup)

Sentinel auto-discovers the Trellis directory by walking up from the current working directory. It also auto-detects the site by matching cwd against each site's `local_path` in `wordpress_sites.yml`.

**Trellis flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--trellis` | — | Enable Trellis credential source |
| `--trellis-dir` | auto-discover | Path to your `trellis/` directory |
| `--site` | auto-detect from cwd | Site key, e.g. `demo.imagewize.com` |
| `--env` | `development` | Trellis environment (`development`, `staging`, `production`) |
| `--subsite` | — | Multisite subsite slug (appended to URL) |

**Bedrock support:** When `--trellis` is used, sentinel auto-detects Bedrock installs by reading `WP_SITEURL` from the site's `.env` file. Bedrock puts WordPress core in `/wp/`, so admin URLs become `/wp/wp-admin/` instead of `/wp-admin/`. No extra flags needed — this is handled automatically.

---

## Quickstart with `.env`

```bash
cp .env.example .env
# edit .env with your site URL and admin credentials
```

---

## Install

```bash
npm install
npx playwright install chromium
```

## Usage

```bash
# Minimal — credentials come from .env
node bin/sentinel.js path/to/patterns/

# Validate a directory (credentials via flags)
node bin/sentinel.js \
  --url=http://imagewize.test \
  --user=admin \
  --pass=secret \
  path/to/patterns/

# Validate specific files
node bin/sentinel.js patterns/hero.php patterns/cta.php

# JSON output (one result object per line)
node bin/sentinel.js --json --url=... path/to/patterns/

# Keep draft pages in WordPress after validation
node bin/sentinel.js --keep-page --url=... path/to/patterns/

# Run headed (watch the browser)
node bin/sentinel.js --no-headless --url=... path/to/patterns/

# Adjust concurrency (default: 4)
node bin/sentinel.js --concurrency=6 --url=... path/to/patterns/
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--url` | `http://localhost` | WordPress site URL |
| `--user` | `admin` | Admin username |
| `--pass` | `password` | Admin password |
| `--wp-subdir` | — | WP core subdir when not using `--trellis` (e.g. `wp` for Bedrock). Sets admin URL to `{url}/{subdir}`. Auto-detected from `WP_SITEURL` when `--trellis` is used. |
| `--headless` | `true` | Run browser headless |
| `--concurrency` | `4` | Parallel workers |
| `--json` | `false` | Output JSON (one result per line) |
| `--keep-page` | `false` | Don't delete draft pages after validation |
| `--width` | `1280` | Viewport width |
| `--height` | `800` | Viewport height |

## Architecture

```
bin/sentinel.js      CLI entry point
src/
  main.js            Orchestration — context pool, p-queue, summary
  login.js           loginToWordPress()
  editor.js          createDraftPage, insertPatternIntoEditor, savePage, deletePage, extractBlockContent
  validation.js      checkBlockValidation, compareContent
  args.js            parseArgs, resolveFiles
  format.js          log, formatResult, printSummary
```

Each worker gets its own authenticated `BrowserContext` so session failures are isolated. Login happens once per context before the queue starts.

## npm publish

When ready to publish:

```bash
npm login
npm publish --access public
```

Then use globally:

```bash
npx wp-pattern-sentinel --url=http://imagewize.test --user=admin --pass=secret patterns/
```

## Exit codes

- `0` — all patterns passed
- `1` — one or more patterns failed
