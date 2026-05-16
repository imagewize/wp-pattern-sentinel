import { log } from './format.js';

export async function loginToWordPress(page, adminUrl, user, pass) {
  try {
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
      log(`Login failed: ${error?.trim() ?? 'unexpected URL after submit: ' + page.url()}`, 'red');
      return false;
    }

    return true;
  } catch (error) {
    log(`Login failed: ${error.message}`, 'red');
    return false;
  }
}
