import { log } from './format.js';

const RETRY_DELAYS = [5_000, 15_000, 30_000]; // ms between attempts 1→2, 2→3, 3→4

export async function loginToWordPress(page, adminUrl, user, pass) {
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS[attempt - 1];
      log(`  Login timeout — waiting ${delay / 1000}s before retry ${attempt}/${RETRY_DELAYS.length}...`, 'yellow');
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    try {
      const result = await attemptLogin(page, adminUrl, user, pass);
      return result; // true = success, false = credential error (don't retry)
    } catch (err) {
      const shortMsg = err.message.split('\n')[0];
      if (attempt < RETRY_DELAYS.length) {
        log(`  Login attempt ${attempt + 1} timed out: ${shortMsg}`, 'yellow');
      } else {
        log(`Login failed after ${RETRY_DELAYS.length + 1} attempts: ${shortMsg}`, 'red');
        return false;
      }
    }
  }

  return false;
}

async function attemptLogin(page, adminUrl, user, pass) {
  // Navigate to the editor — WordPress redirects to wp-login.php if unauthenticated,
  // with redirect_to preserving the editor URL (important for multisite subsite context).
  await page.goto(`${adminUrl}/wp-admin/post-new.php?post_type=page`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  // Already logged in — editor loaded directly
  if (await page.locator('.edit-post-layout, .editor-styles-wrapper').count() > 0) {
    return true;
  }

  // Wait for the login form to be ready before filling
  await page.waitForSelector('#user_login', { state: 'visible', timeout: 30000 });
  await page.fill('#user_login', user);
  await page.fill('#user_pass', pass);

  // Start listening for navigation BEFORE clicking — avoids missing the redirect
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
    page.click('#wp-submit'),
  ]);

  const loggedIn = page.url().includes('/wp-admin/') && !page.url().includes('wp-login.php');
  if (!loggedIn) {
    const error = await page.textContent('#login_error').catch(() => null);
    // Credential error — no point retrying
    log(`Login rejected: ${error?.trim() ?? 'unexpected URL after submit: ' + page.url()}`, 'red');
    return false;
  }

  return true;
}
