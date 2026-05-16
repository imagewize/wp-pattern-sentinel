import { log } from './format.js';

/**
 * Strip the PHP file header (opening tag + docblock) and return the raw block markup.
 * Returns null if no block comment is found.
 *
 * WordPress pattern files look like:
 *   <?php
 *   /**
 *    * Title: My Pattern
 *    * ...
 *    *\/
 *   ?>
 *   <!-- wp:group -->...
 */
export function extractBlockContent(fileContent) {
  const stripped = fileContent
    .replace(/^<\?php\s*/m, '')
    .replace(/\/\*\*[\s\S]*?\*\//m, '')
    .replace(/^\s*\?>\s*/m, '')
    .trim();

  if (!stripped.startsWith('<!--')) return null;
  return stripped;
}

/**
 * Navigate to a new draft page and return its post ID.
 * WordPress redirects post-new.php → post.php?post=ID&action=edit,
 * so we can read the ID directly from the final URL.
 */
export async function createDraftPage(page, baseUrl) {
  try {
    await page.goto(`${baseUrl}/wp-admin/post-new.php?post_type=page`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await page.waitForSelector('.edit-post-layout, .editor-styles-wrapper', {
      timeout: 30000,
    });

    const url = page.url();
    const match = url.match(/[?&]post=(\d+)/);
    if (match) return parseInt(match[1], 10);

    // Fallback: read from wp.data (editor may not have redirected yet)
    return await page.evaluate(() =>
      window.wp?.data?.select('core/editor')?.getCurrentPostId?.() ?? null
    );
  } catch (error) {
    log(`Failed to create draft page: ${error.message}`, 'red');
    return null;
  }
}

/**
 * Set the editor content via wp.data and wait for blocks to parse.
 */
export async function insertPatternIntoEditor(page, blockContent) {
  try {
    await page.evaluate(content => {
      window.wp.data.dispatch('core/editor').editPost({ content });
    }, blockContent);

    // Wait until at least one block is present
    await page.waitForFunction(
      () => window.wp.data.select('core/block-editor').getBlocks().length > 0,
      { timeout: 15000 }
    );

    return true;
  } catch (error) {
    log(`Failed to insert pattern: ${error.message}`, 'red');
    return false;
  }
}

/**
 * Trigger savePost() and wait for the editor to finish saving.
 */
export async function savePage(page) {
  const result = { success: false, errors: [], warnings: [] };
  try {
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
export async function deletePage(page, baseUrl, pageId) {
  try {
    await page.evaluate(async id => {
      const nonce = window.wpApiSettings?.nonce ?? '';
      await fetch(`/wp-json/wp/v2/pages/${id}?force=true`, {
        method: 'DELETE',
        headers: { 'X-WP-Nonce': nonce },
      });
    }, pageId);
  } catch {
    // Non-fatal
  }
}
