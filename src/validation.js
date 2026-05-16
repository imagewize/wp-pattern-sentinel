import { log } from './format.js';

/**
 * Walk the block tree and collect any blocks where isValid === false.
 */
export async function checkBlockValidation(page) {
  try {
    return await page.evaluate(() => {
      const walk = blocks => blocks.flatMap(block => [
        ...(block.isValid === false
          ? [{ blockId: block.clientId, blockName: block.name, error: 'Block validation failed' }]
          : []),
        ...walk(block.innerBlocks ?? []),
      ]);
      return walk(window.wp.data.select('core/block-editor').getBlocks());
    });
  } catch (error) {
    log(`Block validation check error: ${error.message}`, 'yellow');
    return [];
  }
}

/**
 * Compare the editor's serialized output against the original source.
 * Whitespace-normalizes both sides before diffing to avoid false positives
 * from indentation changes, then surfaces up to 5 added/removed lines.
 */
export async function compareContent(page, originalContent) {
  const result = { matches: true, errors: [], warnings: [], savedContent: null };

  try {
    const savedContent = await page.evaluate(() =>
      window.wp.data.select('core/editor').getEditedPostContent()
    );
    result.savedContent = savedContent;

    const normalize = str => str.replace(/\s+/g, ' ').trim();
    if (normalize(savedContent) === normalize(originalContent)) return result;

    result.matches = false;

    const origLines  = originalContent.split('\n').map(l => l.trim()).filter(Boolean);
    const savedLines = savedContent.split('\n').map(l => l.trim()).filter(Boolean);

    const removed = origLines.filter(l => !savedLines.includes(l)).slice(0, 5);
    const added   = savedLines.filter(l => !origLines.includes(l)).slice(0, 5);

    if (removed.length > 0) {
      result.errors.push({
        type: 'content_mismatch',
        message: `Content removed by editor:\n    ${removed.join('\n    ')}`,
      });
    }
    if (added.length > 0) {
      result.warnings.push({
        type: 'content_injected',
        message: `Content injected by editor:\n    ${added.join('\n    ')}`,
      });
    }
  } catch (error) {
    result.errors.push({ type: 'comparison_error', message: error.message });
  }

  return result;
}
