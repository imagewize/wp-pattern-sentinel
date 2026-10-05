# wp-pattern-sentinel

[![npm version](https://img.shields.io/npm/v/@imwz/wp-pattern-sentinel.svg)](https://www.npmjs.com/package/@imwz/wp-pattern-sentinel)
[![npm downloads](https://img.shields.io/npm/dt/@imwz/wp-pattern-sentinel.svg)](https://www.npmjs.com/package/@imwz/wp-pattern-sentinel)
[![License](https://img.shields.io/npm/l/@imwz/wp-pattern-sentinel.svg)](https://github.com/imagewize/wp-pattern-sentinel/blob/main/package.json)

Browser-based WordPress block pattern validator. Loads each pattern into the Gutenberg editor via Playwright, saves it, and checks for block validation errors and content mismatches. Validates `.php` pattern files and `.html` files of raw block markup. See [What it validates](#what-it-validates-php-and-html).

## Why browser-based?

WordPress block validation is a JavaScript concern. The editor's `save()` function can inject styles, reorder CSS classes, and drop attributes in ways that PHP cannot replicate. Only a real browser can catch these errors.

## Credentials

Credentials are resolved in this order — the first match wins:

1. **`--trellis` flag** — reads directly from Roots Trellis vault + `wordpress_sites.yml` (`--user` / `--pass` still override the username and password)
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

**Different admin user:** Trellis provisions a WordPress user named `admin`, and that is the username Sentinel logs in with. If the local database was pulled from production, `admin` may not exist and login fails with "The username admin is not registered on this site". Pass the real admin with `--user`. Add `--pass` if that user's password differs from the vault's `admin_password`. URL and Bedrock detection still come from Trellis.

```bash
sentinel --trellis --site=example.com --user=jane path/to/patterns/

# Password from your shell rather than the command line history; an empty value keeps the vault password
sentinel --trellis --site=example.com --user=jane --pass="$WP_PASS" path/to/patterns/
```

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

# Raw block markup (.html) — block fixtures or post drafts
node bin/sentinel.js tests/sentinel/ drafts/my-post.html

# JSON output (one result object per line)
node bin/sentinel.js --json --url=... path/to/patterns/

# Keep draft pages in WordPress after validation
node bin/sentinel.js --keep-page --url=... path/to/patterns/

# Run headed (watch the browser)
node bin/sentinel.js --no-headless --url=... path/to/patterns/

# Adjust concurrency (default: 4)
node bin/sentinel.js --concurrency=6 --url=... path/to/patterns/

# Show verbose step-by-step output
node bin/sentinel.js --verbose --url=... path/to/patterns/
```

## What it validates: `.php` and `.html`

Sentinel never asks WordPress for registered patterns. It reads block markup from a file, puts it into a new draft page in the editor, saves the page and compares the result. So a file doesn't have to be a registered pattern; it only has to contain serialized blocks. A folder argument is scanned recursively for both extensions, skipping `node_modules`, `vendor` and dot-folders such as `.git`. Point Sentinel at the pattern or fixture folder rather than a block theme's root: `templates/*.html` and `parts/*.html` are block markup too, but they are site templates, not post content, and don't belong in a page round-trip.

| Extension | What it holds | What Sentinel strips before inserting |
|-----------|---------------|---------------------------------------|
| `.php` | A WordPress pattern file: PHP header, then block markup | Everything up to the first `?>` (docblock, `ABSPATH` guard), then inline PHP such as `esc_html_e()` is replaced with static text |
| `.html` | Raw serialized blocks, exactly as WordPress stores them in `post_content` | Only a **leading** header made of plain HTML comments (`<!-- SUGGESTED TITLE: … -->`) and Blade comments (`{{-- … --}}`) |

### When to use `.html`

- **Testing a block that no pattern uses.** A theme block that only ever appears in post content (a CTA, a callout) has no pattern file for Sentinel to pick up. Don't wrap it in a fake pattern header. Save the block's markup as it is serialized in a real post, for example copied from `wp post get <id> --field=post_content`, as `tests/sentinel/<block>.html`.
- **Checking post or page drafts before import.** Drafts written as `.html` block markup can be validated as they are. Header notes at the top of the file are skipped. Without that, the editor would wrap them in a Classic block and Sentinel would report a false mismatch.

```bash
# A theme's block fixtures
sentinel --trellis --site=example.com tests/sentinel/

# Blog drafts before they are imported
sentinel --trellis --site=example.com drafts/blog-posts/
```

### Rules for `.html` files

- After the header, the file must start with a block comment (`<!-- wp:… -->`). Otherwise it fails with `extraction_error`.
- Only the header is stripped. A non-block comment *after* the first block is left in, because in post content it is real content.
- There's no PHP handling, so an `.html` file containing `<?php` is inserted as is.
- Use markup the editor actually produced, not hand-written HTML. The test's value is that a real serialization round-trips cleanly.

### Blocks with a locked template

A block that renders `InnerBlocks` with a `template` and `templateLock: "all"` or `"contentOnly"` is re-synced to that template when the editor loads it. Gutenberg matches inner blocks by position, adds any the template has extra, and removes any it no longer has. A fixture holding the markup a post stored *before* a template change will therefore fail with `content_mismatch`, and that is correct. It is exactly the change an editor would see on opening such a post. Keep one fixture per current template, and run an old one on purpose when you want to see how existing posts will be affected.

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--url` | `http://localhost` | WordPress site URL |
| `--user` | `admin` | Admin username. Overrides the Trellis username when used with `--trellis` |
| `--pass` | `password` | Admin password. Overrides the vault password when used with `--trellis` |
| `--wp-subdir` | — | WP core subdir when not using `--trellis` (e.g. `wp` for Bedrock). Sets admin URL to `{url}/{subdir}`. Auto-detected from `WP_SITEURL` when `--trellis` is used. |
| `--headless` | `true` | Run browser headless |
| `--concurrency` | `4` | Parallel workers |
| `--json` | `false` | Output JSON (one result per line) |
| `--keep-page` | `false` | Don't delete draft pages after validation |
| `--verbose` | `false` | Show detailed step-by-step progress for each pattern, with the time each step took |
| `--width` | `1280` | Viewport width |
| `--height` | `800` | Viewport height |
| `--cache` | `false` | Skip patterns that previously passed with the same file content (see [Pass cache](#pass-cache)) |
| `--clear-cache` | `false` | Delete `.sentinel-cache.json` and exit (or combine with a path to clear then validate) |
| `--log` | `false` | Always write `sentinel-<timestamp>.log.json`, even when all patterns pass |

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

Each worker gets its own authenticated `BrowserContext` so session failures are isolated. Login happens once, then cookies are shared across all contexts — concurrent logins are never attempted.

### Login resilience

If the WordPress login page times out (common on slow local VMs), sentinel retries automatically with exponential backoff:

| Attempt | Wait before retry |
|---------|-------------------|
| 1st | — |
| 2nd | 5 s |
| 3rd | 15 s |
| 4th (final) | 30 s |

Credential rejections (wrong password) are not retried — only timeout errors trigger the backoff.

### Real-time output

Each pattern result is printed to the terminal as soon as that worker finishes, rather than buffering everything until the full batch completes. During a long concurrent run you see progress immediately.

### Pass cache

`--cache` stores a `.sentinel-cache.json` file in the working directory. Each entry records the file's content hash and the last pass result:

```json
{
  "patterns/main-hero.php": {
    "hash": "a1b2c3d4e5f6",
    "passed": true,
    "checkedAt": "2026-05-16T10:00:00.000Z"
  }
}
```

On subsequent runs, if a pattern file's content hash matches the cached entry **and** it previously passed, the pattern is skipped. If the file has changed (even by one byte), it is re-validated and the cache entry is updated. Failed patterns are always removed from the cache so they are never skipped.

```bash
# First run — validates all, populates cache
sentinel --cache --log patterns/

# Later runs — only validates new or changed patterns
sentinel --cache --log patterns/

# Reset the cache (e.g. after a theme.json change that affects all patterns)
sentinel --clear-cache

# Clear and immediately re-validate
sentinel --clear-cache --cache --log patterns/
```

Commit `.sentinel-cache.json` to track validated state across sessions. Add it to `.gitignore` if you prefer each developer to maintain their own local cache.

### Failure log

When any pattern fails, sentinel automatically writes a `sentinel-<timestamp>.log.json` file in the current working directory and prints the path after the summary. This preserves error details for later inspection without needing to re-run. Use `--log` to write the file even on a fully-passing run.

Failing results include a `savedContent` field — the editor's serialized output — so you can diff it directly against the source file:

```bash
node -e "
  const log = JSON.parse(require('fs').readFileSync('sentinel-*.log.json'));
  const r = log.results.find(r => !r.passed);
  console.log(r.savedContent);
" | diff - patterns/my-pattern.php
```

`block_validation` errors also surface Gutenberg's human-readable issue messages (e.g. `"Expected attribute 'class' of value '…' but got '…'"`), so you no longer need to open the browser console to identify what failed.

A block can also pass validation only because one of its block type's deprecations accepted the markup and migrated it. The editor reports such a block as valid, but it saves different markup, and it shows as broken the next time the page is opened. Sentinel re-validates every parsed block against its original markup and reports these as `block_validation` errors reading "Block was migrated by a deprecation and will save different markup". A common cause is an attribute the block does not support, such as `aria-hidden` on `core/paragraph`.

`--cache` entries record the Sentinel version that passed them, so upgrading Sentinel re-validates every pattern once.

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

A `page_creation_error` means the block editor didn't load, so the pattern was never tested. This happens when several workers load the editor at once on a small PHP-FPM pool (e.g. Laravel Valet) and some editor scripts return 502. Sentinel detects this as soon as the page loads and retries up to three times, with a randomized delay, before giving up. The summary counts these failures as infrastructure errors, separate from validation failures. They still exit with `1`. If they keep happening, lower `--concurrency`.
