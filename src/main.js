import { chromium } from 'playwright';
import PQueue from 'p-queue';
import path from 'path';
import fs from 'fs';
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

export async function main() {
  const options = await parseArgs(process.argv.slice(2));
  const files   = resolveFiles(options.files);

  if (files.length === 0) {
    log('No pattern files found.', 'red');
    process.exit(1);
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
    const firstContext = await browser.newContext({ viewport: options.viewport });
    const loginPage    = await firstContext.newPage();
    loginPage.setDefaultTimeout(60000);
    const ok = await loginToWordPress(loginPage, options.adminUrl, options.user, options.pass);
    await loginPage.close();
    if (!ok) throw new Error('Failed to authenticate with WordPress');

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

  // Push ALL tasks without awaiting — this is what makes workers run in parallel
  const promises = files.map(file => {
    const context = contexts[idx++ % options.concurrency];
    return queue.add(() => validatePatternFile(file, options, context));
  });

  const results = await Promise.all(promises);

  await Promise.all(contexts.map(c => c.close()));
  await browser.close();

  if (options.json) {
    for (const r of results) console.log(JSON.stringify(r));
  } else {
    for (const r of results) console.log(formatResult(r));
    printSummary(results);
  }

  process.exit(results.some(r => !r.passed) ? 1 : 0);
}

async function validatePatternFile(patternPath, options, context) {
  const patternName = path.basename(patternPath);
  const startTime   = Date.now();

  let fileContent;
  try {
    fileContent = await fs.promises.readFile(patternPath, 'utf8');
  } catch (error) {
    return fail(patternName, startTime, 'file_error', error.message);
  }

  const blockContent = extractBlockContent(fileContent);
  if (!blockContent) {
    return fail(patternName, startTime, 'extraction_error', 'Could not extract block content from file');
  }

  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  try {
    const pageId = await createDraftPage(page, options.adminUrl);
    if (pageId === null) {
      return fail(patternName, startTime, 'page_creation_error', 'Failed to create test page');
    }

    if (!(await insertPatternIntoEditor(page, blockContent))) {
      await deletePage(page, options.adminUrl, pageId);
      return fail(patternName, startTime, 'insertion_error', 'Failed to insert pattern into editor');
    }

    const saveResult  = await savePage(page);
    const blockErrors = await checkBlockValidation(page);

    if (blockErrors.length > 0) {
      saveResult.errors.push(...blockErrors.map(e => ({
        type:    'block_validation',
        message: `${e.blockName} (${e.blockId}): ${e.error}`,
      })));
    }

    const comparison = await compareContent(page, blockContent);
    saveResult.errors.push(...comparison.errors);
    saveResult.warnings.push(...comparison.warnings);

    if (!options.keepPage) {
      await deletePage(page, options.adminUrl, pageId);
    }

    return {
      pattern:      patternName,
      passed:       saveResult.success && comparison.matches && blockErrors.length === 0,
      errors:       saveResult.errors,
      warnings:     saveResult.warnings,
      duration:     Date.now() - startTime,
      savedContent: comparison.savedContent,
    };

  } catch (error) {
    log(`Unexpected error — ${patternName}: ${error.message}`, 'red');
    return fail(patternName, startTime, 'validation_error', error.message);
  } finally {
    await page.close();
  }
}

function fail(pattern, startTime, type, message) {
  return {
    pattern,
    passed:   false,
    errors:   [{ type, message }],
    warnings: [],
    duration: Date.now() - startTime,
  };
}
