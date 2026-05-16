# wp-pattern-sentinel

Browser-based WordPress block pattern validator. Loads each pattern into the Gutenberg editor via Playwright, saves it, and checks for block validation errors and content mismatches.

## Why browser-based?

WordPress block validation is a JavaScript concern. The editor's `save()` function can inject styles, reorder CSS classes, and drop attributes in ways that PHP cannot replicate. Only a real browser can catch these errors.

## Install

```bash
npm install
npx playwright install chromium
```

## Usage

```bash
# Validate a directory of patterns
node bin/sentinel.js \
  --url=http://imagewize.test \
  --user=admin \
  --pass=secret \
  path/to/patterns/

# Validate specific files
node bin/sentinel.js --url=http://imagewize.test --user=admin --pass=secret \
  patterns/hero.php patterns/cta.php

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
