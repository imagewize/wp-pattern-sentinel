import { log } from './format.js';

export async function loginToWordPress(page, adminUrl, user, pass) {
  try {
    await page.goto(`${adminUrl}/wp-login.php`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.fill('#user_login', user);
    await page.fill('#user_pass', pass);
    await page.click('#wp-submit');
    await page.waitForURL(`${adminUrl}/wp-admin/**`, { timeout: 15000 });
    return true;
  } catch (error) {
    log(`Login failed: ${error.message}`, 'red');
    return false;
  }
}
