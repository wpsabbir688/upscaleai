import { test, expect } from '@playwright/test';

// No-backend specs: the API answers every /api/* request with HTML
// (exactly what the Netlify SPA fallback did on the frontend-only live
// site). The app must fail CLEANLY: logged-out header, gated studio,
// clear errors — never a fake logged-in user, never a blank page.
//
// The playwright webServer still starts the real API + preview build, but
// page.route interception below overrides every /api request, so no test
// here depends on the real server.

const SPA_HTML =
  '<!doctype html><html><head><title>UpscaleAI — Enhance Beyond Limits</title></head>' +
  '<body><div id="root"></div></body></html>';

async function interceptNoBackend(page) {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: SPA_HTML }),
  );
}

async function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test.describe('no-backend (HTML for /api)', () => {
  test('header shows logged-OUT controls, never a blank credit count', async ({ page }) => {
    await interceptNoBackend(page);
    await page.goto('/');
    const header = page.locator('header');
    await expect(header).toBeVisible();
    await expect(header.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(header.getByRole('link', { name: 'Register' })).toBeVisible();
    // No logged-in controls and no credit text anywhere in the header.
    await expect(header.getByRole('button', { name: 'Log out' })).toHaveCount(0);
    await expect(header).not.toContainText('credits');
    await expect(header).not.toContainText('Add credits');
  });

  test('/studio while logged out redirects to /login, never renders Studio UI', async ({ page }) => {
    await interceptNoBackend(page);
    await page.goto('/studio');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'AI Upscaler Studio' })).toHaveCount(0);
    await expect(page.locator('header')).toBeVisible();
  });

  test('pages do not blank on visit, scroll, and reload under failing API', async ({ page }) => {
    await interceptNoBackend(page);
    const errors = await collectPageErrors(page);
    for (const route of ['/', '/login', '/register', '/studio']) {
      await page.goto(route);
      await expect(page.locator('header')).toBeVisible();
      const body = (await page.evaluate(() => document.body.innerText || '')).trim();
      expect(body.length, `${route} rendered blank`).toBeGreaterThan(0);
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(300);
      const afterScroll = (await page.evaluate(() => document.body.innerText || '')).trim();
      expect(afterScroll.length, `${route} blanked on scroll`).toBeGreaterThan(0);
      await page.reload();
      await expect(page.locator('header')).toBeVisible();
      const afterReload = (await page.evaluate(() => document.body.innerText || '')).trim();
      expect(afterReload.length, `${route} blanked on reload`).toBeGreaterThan(0);
    }
    expect(errors, `page errors under failing API: ${errors.join(' | ')}`).toEqual([]);
  });

  test('register and login show the backend-not-connected error, not a bare 404', async ({ page }) => {
    await interceptNoBackend(page);
    await page.goto('/register');
    await page.getByLabel('Email', { exact: true }).fill('nobody@e2e.local');
    await page.getByLabel(/Password/).fill('TestPass123');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText(/not connected/)).toBeVisible();
    await expect(page.getByText('Request failed (404)')).toHaveCount(0);

    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('nobody@e2e.local');
    await page.getByLabel('Password', { exact: true }).fill('TestPass123');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText(/not connected/)).toBeVisible();
  });

  test('header does not wrap at tablet widths', async ({ page }) => {
    await interceptNoBackend(page);
    for (const width of [768, 900, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      await expect(page.locator('header')).toBeVisible();
      // Hamburger takes over below lg; at lg itself the desktop nav shows.
      // Either way the header must stay one row tall.
      if (width < 1024) {
        await expect(page.getByTestId('mobile-menu-button')).toBeVisible();
      } else {
        await expect(page.locator('header nav').first()).toBeVisible();
      }
      const headerH = await page.locator('header').evaluate((el) => el.getBoundingClientRect().height);
      expect(headerH, `header wrapped at ${width}px (height ${headerH})`).toBeLessThan(80);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);
    }
  });
});
