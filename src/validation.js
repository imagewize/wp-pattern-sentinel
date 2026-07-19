import { log } from './format.js';

/**
 * Walk the block tree and collect any blocks where isValid === false.
 */
export async function checkBlockValidation(page) {
  try {
    return await page.evaluate(() => {
      const walk = blocks => blocks.flatMap(block => [
        ...(block.isValid === false
          ? [{
              blockId:          block.clientId,
              blockName:        block.name,
              error:            'Block validation failed',
              validationIssues: (block.validationIssues ?? []).map(issue => {
                try {
                  return (issue.args ?? [])
                    .map(a => (typeof a === 'string' ? a : JSON.stringify(a)))
                    .join(' ');
                } catch { return 'unknown issue'; }
              }),
            }]
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
 * Strip the `ref` key WordPress injects into wp:navigation block comments when
 * a pattern is first loaded in the editor. All FSE themes ship navigation
 * patterns without a ref; WordPress assigns one automatically and it must not
 * be treated as a content mismatch.
 */
const stripNavRef = str =>
  str.replace(/(<!-- wp:navigation \{)"ref":\d+,\s*/g, '$1');

/**
 * Sort CSS property declarations within every style="..." attribute
 * alphabetically so WordPress's CSS property reordering does not produce
 * false content_mismatch failures.
 */
const normalizeCssProps = str =>
  str.replace(/style="([^"]+)"/g, (_, props) => {
    const sorted = props.split(';').map(p => p.trim()).filter(Boolean).sort().join(';');
    return `style="${sorted}"`;
  });

/**
 * Deep-sort JSON object keys alphabetically so WordPress's block-attribute
 * serialization order (which varies by block type) does not produce false
 * content_mismatch failures.
 */
const deepSortKeys = obj => {
  if (Array.isArray(obj)) return obj.map(deepSortKeys);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(Object.keys(obj).sort().map(k => [k, deepSortKeys(obj[k])]));
  }
  return obj;
};

const normalizeBlockAttrJson = str => {
  const BLOCK_COMMENT = /<!-- wp:[^\s]+ ({[\s\S]*?}) (?:\/-->|-->)/g;
  return str.replace(BLOCK_COMMENT, (match, json) => {
    try {
      const sorted = JSON.stringify(deepSortKeys(JSON.parse(json)));
      return match.replace(json, sorted);
    } catch {
      return match;
    }
  });
};

/**
 * Collapse whitespace (including newlines) between adjacent tags/comments to
 * nothing. Custom blocks that render their wrapper markup via JSX (e.g.
 * `<div><div className="inner">...`) serialize with zero whitespace between
 * elements, while hand-authored pattern PHP conventionally puts each nested
 * element on its own line for readability. That's insignificant whitespace —
 * browsers treat it identically — so it must not produce a content_mismatch.
 */
const collapseInterTagWhitespace = str => str.replace(/>\s+</g, '><');

/** Apply all WordPress serializer normalizations to both sides before diffing. */
const normalizeForComparison = str =>
  collapseInterTagWhitespace(normalizeBlockAttrJson(normalizeCssProps(stripNavRef(str))));

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
    if (normalize(normalizeForComparison(savedContent)) === normalize(normalizeForComparison(originalContent))) return result;

    result.matches = false;

    const origLines  = normalizeForComparison(originalContent).split('\n').map(l => l.trim()).filter(Boolean);
    const savedLines = normalizeForComparison(savedContent).split('\n').map(l => l.trim()).filter(Boolean);

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
