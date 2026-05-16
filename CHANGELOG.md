# Changelog

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
