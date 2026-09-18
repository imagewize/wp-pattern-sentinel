import { log } from './format.js';

/**
 * Replace inline PHP expressions with static equivalents so the block editor
 * receives valid markup and the round-trip comparison stays accurate.
 *
 * Handles the PHP patterns that appear in Elayne theme patterns:
 *   <?php esc_html_e( 'Text', 'elayne' ); ?>           → Text
 *   <?php echo esc_html__( 'Text', 'elayne' ); ?>      → Text
 *   <?php esc_attr_e( 'Alt text', 'elayne' ); ?>       → Alt text
 *   <?php echo esc_attr__( 'Alt text', 'elayne' ); ?>  → Alt text
 *   <?php echo esc_url( get_template_directory_uri() ); ?>  → http://example.com
 *   All other <?php ... ?> blocks                       → removed
 */
function stripPhpForValidation(content) {
  if (!content.includes('<?php')) return content;

  const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return content
    .replace(/<\?php\s+(?:esc_html_e|esc_html__)\s*\(\s*'([^']+)'\s*,\s*'[^']+'\s*\)\s*;?\s*\?>/g, (_, t) => esc(t))
    .replace(/<\?php\s+(?:esc_html_e|esc_html__)\s*\(\s*"([^"]+)"\s*,\s*"[^"]+"\s*\)\s*;?\s*\?>/g, (_, t) => esc(t))
    .replace(/<\?php\s+echo\s+esc_html__\s*\(\s*'([^']+)'\s*,\s*'[^']+'\s*\)\s*;?\s*\?>/g, (_, t) => esc(t))
    .replace(/<\?php\s+(?:esc_attr_e|esc_attr__)\s*\(\s*'([^']+)'\s*,\s*'[^']+'\s*\)\s*;?\s*\?>/g, '$1')
    .replace(/<\?php\s+(?:esc_attr_e|esc_attr__)\s*\(\s*"([^"]+)"\s*,\s*"[^"]+"\s*\)\s*;?\s*\?>/g, '$1')
    .replace(/<\?php\s+echo\s+esc_attr__\s*\(\s*'([^']+)'\s*,\s*'[^']+'\s*\)\s*;?\s*\?>/g, '$1')
    .replace(/<\?php\s+echo\s+esc_url\s*\([\s\S]*?\)\s*;?\s*\?>/g, 'http://example.com')
    .replace(/<\?php[\s\S]*?\?>/g, '')
    .trim();
}

/**
 * Strip the PHP file header (opening tag, docblock, and any header-only PHP
 * such as a direct-access guard) and return the raw block markup. Inline PHP
 * expressions within the block markup are replaced with static values so the
 * editor receives valid content for round-trip validation. Returns null if no
 * block comment is found.
 *
 * WordPress pattern files look like:
 *   <?php
 *   /**
 *    * Title: My Pattern
 *    * ...
 *    *\/
 *
 *   if ( ! defined( 'ABSPATH' ) ) {
 *       exit; // Optional direct-access guard (e.g. Aludra patterns).
 *   }
 *   ?>
 *   <!-- wp:group -->...
 *
 * The header is everything up to and including the *first* closing PHP tag,
 * regardless of what it contains (docblock only, or docblock + guard) — so a
 * single non-greedy strip handles both shapes in one pass.
 */
export function extractBlockContent(fileContent) {
  const stripped = fileContent
    .replace(/^[\s\S]*?\?>\s*/, '')
    .trim();

  if (!stripped.startsWith('<!--')) return null;
  return stripPhpForValidation(stripped);
}

const PAGE_CREATION_RETRY_DELAYS = [3_000, 8_000, 15_000]; // ms before retries 1, 2, 3 (plus jitter)

/**
 * Navigate to a new draft page and return its post ID, or null on failure.
 * WordPress redirects post-new.php → post.php?post=ID&action=edit,
 * so we can read the ID directly from the final URL.
 *
 * When several workers open post-new.php at once, each cold editor requests
 * ~150 scripts. On a small local PHP-FPM pool (Laravel Valet routes even
 * static files through PHP) the socket backlog overflows and some scripts
 * come back 502, so the editor never boots (#21). That's an infrastructure
 * error, not a pattern failure: detect it as soon as the document has loaded
 * and retry after a jittered backoff, so workers don't collide again.
 */
export async function createDraftPage(page, baseUrl, verbose = false) {
  for (let attempt = 0; attempt <= PAGE_CREATION_RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) {
      const base  = PAGE_CREATION_RETRY_DELAYS[attempt - 1];
      const delay = base + Math.round(Math.random() * base);
      log(`    Editor load failed — waiting ${(delay / 1000).toFixed(1)}s before retry ${attempt}/${PAGE_CREATION_RETRY_DELAYS.length}...`, 'yellow');
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    try {
      return await attemptCreateDraftPage(page, baseUrl, verbose);
    } catch (error) {
      const shortMsg = error.message.split('\n')[0];
      if (attempt < PAGE_CREATION_RETRY_DELAYS.length) {
        log(`    Draft page attempt ${attempt + 1} failed: ${shortMsg}`, 'yellow');
      } else {
        log(`Failed to create draft page after ${attempt + 1} attempts: ${error.message}`, 'red');
      }
    }
  }
  return null;
}

async function attemptCreateDraftPage(page, baseUrl, verbose) {
  const start = Date.now();
  if (verbose) log('    → Creating draft page...', 'gray');

  // Editor scripts are parser-blocking, so every one has responded by
  // domcontentloaded. A server error on any of them means the editor can't
  // boot — fail now instead of waiting out the selector timeout.
  const brokenScripts = [];
  const onResponse = response => {
    if (response.status() >= 500 && response.request().resourceType() === 'script') {
      brokenScripts.push(response.status());
    }
  };
  page.on('response', onResponse);
  try {
    await page.goto(`${baseUrl}/wp-admin/post-new.php?post_type=page`, {
      waitUntil: 'domcontentloaded',
    });
  } finally {
    page.off('response', onResponse);
  }
  if (brokenScripts.length > 0) {
    throw new Error(
      `${brokenScripts.length} editor script(s) failed to load (HTTP ${[...new Set(brokenScripts)].join(', ')}) — server overloaded`
    );
  }
  if (verbose) log(`    → post-new.php loaded (${Date.now() - start}ms)`, 'gray');

  await page.waitForSelector('.edit-post-layout, .editor-styles-wrapper');

  const url = page.url();
  const match = url.match(/[?&]post=(\d+)/);
  if (match) {
    if (verbose) log(`    → Draft page created (${Date.now() - start}ms)`, 'gray');
    return parseInt(match[1], 10);
  }

  // Fallback: read from wp.data (editor may not have redirected yet)
  const pageId = await page.evaluate(() =>
    window.wp?.data?.select('core/editor')?.getCurrentPostId?.() ?? null
  );
  if (pageId === null) throw new Error('Editor loaded but no post ID was found');
  if (verbose) log(`    → Draft page created (${Date.now() - start}ms)`, 'gray');
  return pageId;
}

/**
 * Set the editor content via wp.data and wait for blocks to parse.
 */
export async function insertPatternIntoEditor(page, blockContent, verbose = false) {
  const start = Date.now();
  try {
    if (verbose) log('    → Inserting pattern into editor...', 'gray');
    await page.evaluate(content => {
      window.wp.data.dispatch('core/editor').editPost({ content });
    }, blockContent);

    // Wait until at least one block is present
    await page.waitForFunction(
      () => window.wp.data.select('core/block-editor').getBlocks().length > 0,
      null,
      { timeout: 15000 }
    );

    if (verbose) log(`    → Pattern inserted (${Date.now() - start}ms)`, 'gray');
    return true;
  } catch (error) {
    log(`Failed to insert pattern: ${error.message}`, 'red');
    return false;
  }
}

/**
 * Trigger savePost() and wait for the editor to finish saving.
 */
export async function savePage(page, verbose = false) {
  const result = { success: false, errors: [], warnings: [] };
  const start  = Date.now();
  try {
    if (verbose) log('    → Saving page...', 'gray');
    // savePost() resolves once the save request and its hooks have finished,
    // and evaluate() awaits it — so isSavingPost() is already false here.
    // Don't wait for the save to *start*: that condition never becomes true
    // again and the wait runs to its full timeout (the 60s stall in #21).
    await page.evaluate(() => window.wp.data.dispatch('core/editor').savePost());

    // waitForFunction's second parameter is the page-function arg, so options
    // must go third — passed second, the timeout is silently ignored.
    await page.waitForFunction(
      () => !window.wp.data.select('core/editor').isSavingPost(),
      null,
      { timeout: 30000 }
    );

    if (verbose) log(`    → Page saved (${Date.now() - start}ms)`, 'gray');
    result.success = true;
  } catch (error) {
    result.errors.push({ type: 'save_error', message: error.message });
  }
  return result;
}

/**
 * Delete the draft page via the WP REST API (uses the active browser session's nonce).
 * Non-fatal — a failure here does not affect validation results.
 */
export async function deletePage(page, baseUrl, pageId, verbose = false) {
  const start = Date.now();
  try {
    if (verbose) log('    → Deleting draft page...', 'gray');
    await page.evaluate(async id => {
      const nonce = window.wpApiSettings?.nonce ?? '';
      await fetch(`/wp-json/wp/v2/pages/${id}?force=true`, {
        method: 'DELETE',
        headers: { 'X-WP-Nonce': nonce },
      });
    }, pageId);
    if (verbose) log(`    → Draft page deleted (${Date.now() - start}ms)`, 'gray');
  } catch {
    // Non-fatal
  }
}
