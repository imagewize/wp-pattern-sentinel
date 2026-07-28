import { chromium } from 'playwright';
import PQueue from 'p-queue';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { parseArgs, resolveFiles } from './args.js';
import { loginToWordPress } from './login.js';
import {
  extractBlockContent,
  createDraftPage,
  insertPatternIntoEditor,
  savePage,
  deletePage,
} from './editor.js';
import { checkBlockValidation, compareContent } from './validation.js';
import { log, formatResult, printSummary } from './format.js';

const CACHE_FILE = '.sentinel-cache.json';

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), CACHE_FILE), 'utf8'));
  } catch {
    return {};
  }
}

async function saveCache(cache) {
  try {
    await fs.promises.writeFile(
      path.join(process.cwd(), CACHE_FILE),
      JSON.stringify(cache, null, 2)
    );
  } catch { /* ignore */ }
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

export async function main() {
  const options = await parseArgs(process.argv.slice(2));

  if (options.clearCache) {
    try {
      fs.unlinkSync(path.join(process.cwd(), CACHE_FILE));
      log('Cache cleared.', 'green');
    } catch {
      log('No cache file found.', 'gray');
    }
    if (options.files.length === 0) process.exit(0);
  }

  let files     = resolveFiles(options.files);

  if (files.length === 0) {
    log('No pattern files found.', 'red');
    process.exit(1);
  }

  // Skip patterns that previously passed with the same file content.
  const cache = options.cache ? loadCache() : {};
  const skipped = [];
  if (options.cache) {
    const pending = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const key     = path.relative(process.cwd(), file);
        if (cache[key]?.passed && cache[key]?.hash === hashContent(content)) {
          skipped.push(file);
        } else {
          pending.push(file);
        }
      } catch {
        pending.push(file);
      }
    }
    files = pending;
    if (skipped.length > 0) {
      log(`Skipping ${skipped.length} previously-passed pattern(s) (cached)`, 'gray');
    }
  }

  if (files.length === 0) {
    log('All patterns already validated — nothing to do.', 'green');
    process.exit(0);
  }

  log(`\nFound ${files.length} pattern(s) — concurrency: ${options.concurrency}`, 'cyan');

  const browser = await chromium.launch({
    headless: options.headless,
    args: ['--disable-web-security'],
  });

  // Login once, then share the session cookies across all worker contexts.
  // Concurrent logins to WordPress (even with valid credentials) trigger a
  // reauth=1 redirect loop — serialising login avoids this entirely.
  let contexts;
  try {
    log('Logging in to WordPress...', 'cyan');
    const firstContext = await browser.newContext({ viewport: options.viewport });
    const loginPage    = await firstContext.newPage();
    loginPage.setDefaultTimeout(60000);
    const ok = await loginToWordPress(loginPage, options.adminUrl, options.user, options.pass);
    await loginPage.close();
    if (!ok) throw new Error('Failed to authenticate with WordPress');
    log(`Authenticated — sharing session across ${options.concurrency} worker(s)`, 'green');

    const cookies = await firstContext.cookies();
    contexts = [firstContext];
    for (let i = 1; i < options.concurrency; i++) {
      const ctx = await browser.newContext({ viewport: options.viewport });
      await ctx.addCookies(cookies);
      contexts.push(ctx);
    }
  } catch (error) {
    log(error.message, 'red');
    await browser.close();
    process.exit(1);
  }

  const queue = new PQueue({ concurrency: options.concurrency });
  let idx = 0;

  // Push ALL tasks without awaiting — workers run in parallel.
  // Print each result immediately as it finishes (real-time feedback).
  const promises = files.map(file => {
    const context = contexts[idx++ % options.concurrency];
    return queue.add(async () => {
      const result = await validatePatternFile(file, options, context);
      if (!options.json) {
        console.log(formatResult(result));
      }
      return result;
    });
  });

  const results = await Promise.all(promises);

  await Promise.all(contexts.map(c => c.close()));
  await browser.close();

  if (options.json) {
    for (const r of results) console.log(JSON.stringify(r));
  }

  printSummary(results, skipped.length);

  // Update cache with results from this run.
  if (options.cache) {
    for (const result of results) {
      const key = path.relative(process.cwd(), result.patternPath);
      if (result.passed) {
        cache[key] = { hash: result.hash, passed: true, checkedAt: new Date().toISOString() };
      } else {
        delete cache[key];
      }
    }
    await saveCache(cache);
    log(`  Cache updated → ${CACHE_FILE}`, 'gray');
  }

  // Write a log file on failure, or always when --log is set.
  const hasFailed = results.some(r => !r.passed);
  if (hasFailed || options.log) {
    const logPath = await writeLogFile(results);
    if (logPath) log(`  Log saved → ${logPath}`, 'gray');
  }

  process.exit(hasFailed ? 1 : 0);
}

async function validatePatternFile(patternPath, options, context) {
  const patternName = path.basename(patternPath);
  const startTime   = Date.now();
  const verbose     = options.verbose;

  log(`  Validating: ${patternName}`, 'cyan');

  let fileContent;
  try {
    fileContent = await fs.promises.readFile(patternPath, 'utf8');
  } catch (error) {
    return fail(patternName, patternPath, startTime, 'file_error', error.message);
  }

  const blockContent = extractBlockContent(fileContent);
  if (!blockContent) {
    return fail(patternName, patternPath, startTime, 'extraction_error', 'Could not extract block content from file');
  }

  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  try {
    const pageId = await createDraftPage(page, options.adminUrl, verbose);
    if (pageId === null) {
      return fail(patternName, patternPath, startTime, 'page_creation_error', 'Failed to create test page');
    }

    if (!(await insertPatternIntoEditor(page, blockContent, verbose))) {
      await deletePage(page, options.adminUrl, pageId, verbose);
      return fail(patternName, patternPath, startTime, 'insertion_error', 'Failed to insert pattern into editor');
    }

    const saveResult  = await savePage(page, verbose);
    const blockErrors = await checkBlockValidation(page, verbose);

    if (blockErrors.length > 0) {
      saveResult.errors.push(...blockErrors.map(e => ({
        type:    'block_validation',
        message: `${e.blockName} (${e.blockId}): ${e.error}${
          e.validationIssues?.length
            ? '\n       Issues: ' + e.validationIssues.join('\n       ')
            : ''
        }`,
      })));
    }

    const comparison = await compareContent(page, blockContent, verbose);
    saveResult.errors.push(...comparison.errors);
    saveResult.warnings.push(...comparison.warnings);

    if (!options.keepPage) {
      await deletePage(page, options.adminUrl, pageId, verbose);
    }

    return {
      pattern:      patternName,
      patternPath,
      hash:         hashContent(fileContent),
      passed:       saveResult.success && comparison.matches && blockErrors.length === 0,
      errors:       saveResult.errors,
      warnings:     saveResult.warnings,
      duration:     Date.now() - startTime,
      savedContent: comparison.savedContent,
    };

  } catch (error) {
    log(`Unexpected error — ${patternName}: ${error.message}`, 'red');
    return fail(patternName, patternPath, startTime, 'validation_error', error.message);
  } finally {
    await page.close();
  }
}

function fail(pattern, patternPath, startTime, type, message) {
  return {
    pattern,
    patternPath,
    hash:     null,
    passed:   false,
    errors:   [{ type, message }],
    warnings: [],
    duration: Date.now() - startTime,
  };
}

async function writeLogFile(results) {
  try {
    const now = new Date();
    const ts  = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const logPath = path.join(process.cwd(), `sentinel-${ts}.log.json`);
    const payload = {
      timestamp: now.toISOString(),
      results: results.map(r => ({
        pattern:  r.pattern,
        passed:   r.passed,
        duration: r.duration,
        errors:   r.errors,
        warnings: r.warnings,
        ...(r.passed ? {} : { savedContent: r.savedContent ?? null }),
      })),
    };
    await fs.promises.writeFile(logPath, JSON.stringify(payload, null, 2));
    return logPath;
  } catch {
    return null;
  }
}
