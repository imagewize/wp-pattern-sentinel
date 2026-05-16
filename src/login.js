import { log } from './format.js';

export async function loginToWordPress(page, url, user, pass) {
  try {
    await page.goto(`${url}/wp-login.php`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.fill('#user_login', user);
    await page.fill('#user_pass', pass);
    await page.click('#wp-submit');
    await page.waitForURL(`${url}/wp-admin/**`, { timeout: 15000 });
    return true;
  } catch (error) {
    log(`Login failed: ${error.message}`, 'red');
    return false;
  }
}
