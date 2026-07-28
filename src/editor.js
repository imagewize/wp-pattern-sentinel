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

/**
 * Navigate to a new draft page and return its post ID.
 * WordPress redirects post-new.php → post.php?post=ID&action=edit,
 * so we can read the ID directly from the final URL.
 */
export async function createDraftPage(page, baseUrl, verbose = false) {
  try {
    if (verbose) log('    → Creating draft page...', 'gray');
    await page.goto(`${baseUrl}/wp-admin/post-new.php?post_type=page`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await page.waitForSelector('.edit-post-layout, .editor-styles-wrapper', {
      timeout: 30000,
    });

    const url = page.url();
    const match = url.match(/[?&]post=(\d+)/);
    if (match) {
      if (verbose) log('    → Draft page created', 'gray');
      return parseInt(match[1], 10);
    }

    // Fallback: read from wp.data (editor may not have redirected yet)
    const pageId = await page.evaluate(() =>
      window.wp?.data?.select('core/editor')?.getCurrentPostId?.() ?? null
    );
    if (verbose && pageId) log('    → Draft page created', 'gray');
    return pageId;
  } catch (error) {
    log(`Failed to create draft page: ${error.message}`, 'red');
    return null;
  }
}

/**
 * Set the editor content via wp.data and wait for blocks to parse.
 */
export async function insertPatternIntoEditor(page, blockContent, verbose = false) {
  try {
    if (verbose) log('    → Inserting pattern into editor...', 'gray');
    await page.evaluate(content => {
      window.wp.data.dispatch('core/editor').editPost({ content });
    }, blockContent);

    // Wait until at least one block is present
    await page.waitForFunction(
      () => window.wp.data.select('core/block-editor').getBlocks().length > 0,
      { timeout: 15000 }
    );

    if (verbose) log('    → Pattern inserted', 'gray');
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
  try {
    if (verbose) log('    → Saving page...', 'gray');
    await page.evaluate(() => window.wp.data.dispatch('core/editor').savePost());

    // Wait for save to start, then finish
    await page
      .waitForFunction(
        () => window.wp.data.select('core/editor').isSavingPost(),
        { timeout: 5000 }
      )
      .catch(() => {}); // save might be near-instant

    await page.waitForFunction(
      () => !window.wp.data.select('core/editor').isSavingPost(),
      { timeout: 30000 }
    );

    if (verbose) log('    → Page saved', 'gray');
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
  try {
    if (verbose) log('    → Deleting draft page...', 'gray');
    await page.evaluate(async id => {
      const nonce = window.wpApiSettings?.nonce ?? '';
      await fetch(`/wp-json/wp/v2/pages/${id}?force=true`, {
        method: 'DELETE',
        headers: { 'X-WP-Nonce': nonce },
      });
    }, pageId);
    if (verbose) log('    → Draft page deleted', 'gray');
  } catch {
    // Non-fatal
  }
}
