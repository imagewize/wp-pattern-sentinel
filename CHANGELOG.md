# Changelog

## [1.0.0] - 2026-05-17

### Fixed
- **`block_validation` errors now include Gutenberg's human-readable issue messages** — `checkBlockValidation` extracts `block.validationIssues` from the Gutenberg store and surfaces each issue's `args` string in the terminal output. Previously the log only showed `"Block validation failed"` with no indication of which attribute or class was wrong; now you see e.g. `"Expected attribute 'class' of value '…' but got '…'"` without needing to open the browser console.
- **`savedContent` written to log for failing patterns** — `writeLogFile` now includes the `savedContent` field (the editor's serialized output) for every pattern that did not pass. This lets you diff the log against the source file directly to identify what the editor changed:
  ```bash
  node -e "
    const log = JSON.parse(require('fs').readFileSync('sentinel-*.log.json'));
    const r = log.results.find(r => !r.passed);
    console.log(r.savedContent);
  " | diff - patterns/my-pattern.php
  ```

## [0.3.0] - 2026-05-16

### Added
- **`--cache` flag** — hash-based pass cache stored in `.sentinel-cache.json` in the working directory. On subsequent runs, patterns whose file content has not changed since they last passed are skipped entirely. The summary now shows a `Skipped (cached)` count alongside Passed/Failed. Cache entries are keyed by path relative to cwd and store a 12-character SHA-256 content hash so stale entries are never replayed after edits.
- **`--clear-cache` flag** — deletes `.sentinel-cache.json`. Can be combined with a pattern path to clear-then-validate in one command, or used standalone to reset without running a validation.
- **`--log` flag** — forces the `sentinel-<timestamp>.log.json` file to be written even when all patterns pass (previously it was written only on failure). Useful for building an audit trail of completed runs.
- **Skipped count in summary** — `printSummary` now accepts an optional `skipped` argument and displays `Skipped : N (cached)` when `--cache` is active and at least one pattern was skipped.

## [0.2.6] - 2026-05-16

### Added
- **Exponential backoff login retry** — on timeout, sentinel now waits 5s and retries; 15s on second timeout; 30s on third before giving up. Credential rejections (wrong password) are not retried — only network/timeout errors trigger the backoff loop.
- **Real-time per-pattern output** — each pattern result is printed to the terminal as soon as it finishes, rather than buffering all results until the full batch completes. Makes long concurrent runs much easier to follow.
- **Automatic failure log** — when any pattern fails, a `sentinel-<timestamp>.log.json` file is written to the current working directory and the path is printed after the summary. This preserves error/warning details for later inspection without needing to re-run.

## [0.2.5] - 2026-05-16

### Fixed
- **PHP expression stripping in block content** — inline PHP expressions (`<?php echo esc_url(...); ?>`, `<?php esc_html_e(...); ?>`, `<?php esc_attr_e(...); ?>`, etc.) inside block markup were passed as-is to the WordPress editor, which HTML-entity-encoded `<` and `>` to `<`/`>`, causing false-positive `content_mismatch` and `block_validation` errors. `extractBlockContent` now runs `stripPhpForValidation` on the block markup before it is handed to the editor — PHP expressions are replaced with their static equivalents (text values or `http://example.com` for URLs) before the round-trip.

### Added
- **Progress logging** — terminal now shows "Logging in to WordPress...", "Authenticated — sharing session across N worker(s)", and "  Validating: pattern.php" for each pattern as it starts, so long validation runs are no longer silent.

## [0.2.4] - 2026-05-16

### Fixed
- **Concurrent login → `reauth=1` loop** — WordPress returns `reauth=1` when multiple browser contexts hit `wp-admin` simultaneously, even with correct credentials. Root cause: concurrent login attempts (the previous `Promise.all` over N contexts) caused WordPress to reject all but one session. Fix: login once with a single context, then copy the authenticated session cookies to all remaining worker contexts (`context.addCookies()`). Workers now share one authenticated session and validate patterns in parallel without any extra login round-trips.

## [0.2.3] - 2026-05-16

### Fixed
- **Login rewrite** — adopted the proven strategy from the reference implementation:
  - Navigate to `wp-admin/post-new.php` first instead of `wp-login.php`; WordPress redirects to the login page with `redirect_to` preserving the editor URL (critical for multisite subsite context)
  - Wait for `#user_login` to be visible before filling the form
  - Use `Promise.all([waitForNavigation, click])` to start listening for navigation before clicking submit — prevents missing the redirect
  - Verify login by checking `url().includes('/wp-admin/')` rather than URL pattern matching
  - Increase navigation timeout to 60s
  - Read and surface `#login_error` message when login fails

## [0.2.2] - 2026-05-16

### Fixed
- Login `waitForURL` now uses `waitUntil: 'domcontentloaded'` with a 30s timeout. The default `'load'` waited for all wp-admin assets to finish loading before resolving, causing timeouts on slower local environments.

## [0.2.1] - 2026-05-16

### Fixed
- Login `waitForURL` now uses a regex (`/\/wp-admin\//`) instead of a glob. Playwright's `**` glob does not match a trailing empty segment, so `wp-admin/**` failed to match the `wp-admin/` redirect URL.

## [0.2.0] - 2026-05-16

### Added
- **Bedrock/WP subdir support** — `--trellis` now auto-detects the WordPress core URL by reading `WP_SITEURL` from the site's `.env` file. Bedrock installs put WP core at `/wp/`, so login and editor operations were targeting `/wp-admin/` instead of `/wp/wp-admin/`. This is now handled automatically.
- **`--wp-subdir` flag** — manual override for non-Trellis setups. Pass `--wp-subdir=wp` when your WP core lives at a subpath (e.g. `http://site.test/wp`). Equivalent to what Trellis auto-detects for Bedrock.

### Changed
- `adminUrl` is now a first-class concept, separate from the site `url`. All login and editor operations use `adminUrl`; the site `url` remains the public-facing URL.
- `login.js` and `editor.js` now accept `adminUrl` instead of `url` for wp-admin operations.

## [0.1.0] - 2026-05-16

### Added
- Initial release — browser-based WordPress block pattern validator via Playwright
- Roots Trellis integration (`--trellis`, `--site`, `--env`, `--subsite`)
- Credential sources: Trellis vault → CLI flags → env vars → `.env` file → interactive prompt
- Parallel validation with configurable concurrency
- JSON output mode
- `--keep-page` flag to retain draft pages after validation
