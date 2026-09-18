import { log } from './format.js';

/**
 * Walk the block tree and collect any blocks where isValid === false.
 */
export async function checkBlockValidation(page, verbose = false) {
  if (verbose) log('    → Checking block validation...', 'gray');
  try {
    const errors = await page.evaluate(() => {
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
    if (verbose) log('    → Block validation complete', 'gray');
    return errors;
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
 * Matches a nested pattern reference: `<!-- wp:pattern {"slug":"theme/x"} /-->`.
 * The editor replaces these with the referenced pattern's blocks, so the
 * source must be expanded the same way before it can be diffed.
 */
const PATTERN_REF = /<!-- wp:pattern (\{[\s\S]*?\}) \/-->/g;

/** Map of registered pattern name → raw content, read from the REST API. */
const fetchRegisteredPatterns = page =>
  page.evaluate(async () => {
    const patterns = await window.wp.apiFetch({ path: '/wp/v2/block-patterns/patterns' });
    return Object.fromEntries(patterns.map(p => [p.name, p.content]));
  });

/**
 * Recursively substitute each `wp:pattern` reference with the referenced
 * pattern's content. Unregistered slugs and self-references are left as-is,
 * mirroring the editor, which leaves those `core/pattern` blocks unexpanded.
 */
const expandPatternRefs = (str, registry, seen = []) =>
  str.replace(PATTERN_REF, (match, json) => {
    let slug;
    try { slug = JSON.parse(json).slug; } catch { return match; }
    if (typeof registry[slug] !== 'string' || seen.includes(slug)) return match;
    return expandPatternRefs(registry[slug], registry, [...seen, slug]);
  });

/**
 * Compare the editor's serialized output against the original source.
 * Whitespace-normalizes both sides before diffing to avoid false positives
 * from indentation changes, then surfaces up to 5 added/removed lines.
 */
export async function compareContent(page, originalContent, verbose = false) {
  const result = { matches: true, errors: [], warnings: [], savedContent: null };

  try {
    if (verbose) log('    → Comparing content...', 'gray');
    const savedContent = await page.evaluate(() =>
      window.wp.data.select('core/editor').getEditedPostContent()
    );
    result.savedContent = savedContent;

    if (originalContent.includes('<!-- wp:pattern ')) {
      try {
        originalContent = expandPatternRefs(originalContent, await fetchRegisteredPatterns(page));
      } catch (error) {
        result.warnings.push({
          type: 'pattern_ref_unresolved',
          message: `Could not resolve nested wp:pattern references: ${error.message}`,
        });
      }
    }

    const normalize = str => str.replace(/\s+/g, ' ').trim();
    if (normalize(normalizeForComparison(savedContent)) === normalize(normalizeForComparison(originalContent))) {
      if (verbose) log('    → Content matches', 'gray');
      return result;
    }

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
    if (verbose) log('    → Content comparison complete', 'gray');
  } catch (error) {
    result.errors.push({ type: 'comparison_error', message: error.message });
  }

  return result;
}
