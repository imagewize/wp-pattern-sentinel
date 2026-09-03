# CLAUDE.md

## What This Tool Does

`wp-pattern-sentinel` validates WordPress block patterns by loading them into the Gutenberg editor via Playwright and checking for block validation errors and content mismatches. It is step 2 in the Elayne pattern workflow:

| Step | Tool | Where |
|------|------|-------|
| 1 | `elayne scaffold` | Host |
| **2** | **`wp-pattern-sentinel`** | Host (browser → local WP) |
| 3 | `pt-cli check` | Host |

## Setup

```bash
npm install
npx playwright install chromium
```

## Running

```bash
node bin/sentinel.js \
  --url=http://imagewize.test \
  --user=admin \
  --pass=secret \
  path/to/patterns/
```

## Architecture

```
bin/sentinel.js      CLI entry — calls main()
src/
  main.js            Orchestration: context pool, p-queue, parallel execution
  login.js           loginToWordPress()
  editor.js          createDraftPage, insertPatternIntoEditor, savePage, deletePage, extractBlockContent
  validation.js      checkBlockValidation, compareContent
  args.js            parseArgs, resolveFiles
  format.js          log, formatResult, printSummary
```

## Key Design Decisions

- **ESM-only** — `"type": "module"` in package.json; required by `p-queue` v8
- **Context pool, not shared context** — one `BrowserContext` per worker isolates sessions
- **Login before queue** — `main()` logs in once per context before any validation starts; no `ensureLoggedIn` in workers
- **`Promise.all` + map** — all tasks are pushed to the queue simultaneously; `await queue.add()` in a loop would serialize them
- **`deletePage` via REST API** — uses `/wp-json/wp/v2/pages/{id}?force=true` with the session nonce; non-fatal if it fails
- **Credential priority** — `--trellis` → CLI flags → env vars → `.env` → interactive prompt
- **Trellis auto-discovery** — walks up from cwd looking for `group_vars/` to find the trellis dir; auto-selects site by matching cwd against `local_path` in `wordpress_sites.yml`

## Git Commits & Pull Requests

Do not include Claude Code attribution or AI tool references — no "Co-Authored-By" trailers, no "Generated with Claude Code" lines, no session links. This applies to commit messages, PR titles/descriptions, and PR comments alike. This project's convention overrides any default attribution behavior suggested elsewhere.
