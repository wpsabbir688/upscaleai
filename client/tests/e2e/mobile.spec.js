import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PNG = path.resolve(here, '../../public/examples/sample256.png');

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '320x568', width: 320, height: 568 },
];

// Page-level sideways scroll is the failure mode: the document must never
// be wider than the viewport. (Decorative clipped elements inside an
// overflow-hidden section do not count — scrollWidth already excludes them.)
async function expectNoOverflow(page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, innerWidth: window.innerWidth };
  });
  expect(
    overflow.scrollWidth,
    `horizontal overflow: scrollWidth ${overflow.scrollWidth} > viewport ${overflow.innerWidth}`,
  ).toBeLessThanOrEqual(overflow.innerWidth + 1);
}

async function register(page, email) {
  await page.goto('/register');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel(/Password/).fill('TestPass123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/studio/);
}

async function login(page, email, password) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/studio/);
}

// Real touch drag through the browser's input pipeline (CDP), so the
// component's pointer handlers fire exactly as a finger drag would.
async function touchDrag(page, from, to, steps = 8) {
  const cdp = await page.context().newCDPSession(page);
  const point = (x, y) => ({
    x, y, radiusX: 10, radiusY: 10, rotationAngle: 0,
    force: 0.5, taperAngle: 0, tiltX: 0, tiltY: 0, twist: 0, id: 1,
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(from.x, from.y)] });
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(x, y)] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

for (const vp of VIEWPORTS) {
  test.describe(`mobile ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('public routes have no horizontal overflow', async ({ page }) => {
      for (const route of ['/', '/login', '/register', '/studio']) {
        await page.goto(route);
        await expect(page.locator('header')).toBeVisible();
        await expectNoOverflow(page);
      }
    });

    test('mobile menu opens, navigates, and closes', async ({ page }) => {
      await page.goto('/');
      const button = page.getByTestId('mobile-menu-button');
      await expect(button).toBeVisible();
      await expect(page.getByTestId('mobile-menu')).toHaveCount(0);
      await button.click();
      const menu = page.getByTestId('mobile-menu');
      await expect(menu).toBeVisible();
      await menu.getByRole('link', { name: 'AI Upscaler' }).click();
      await expect(page).toHaveURL(/\/studio/);
      // Reopen and close via the toggle.
      await page.getByTestId('mobile-menu-button').click();
      await expect(page.getByTestId('mobile-menu')).toBeVisible();
      await page.getByTestId('mobile-menu-button').click();
      await expect(page.getByTestId('mobile-menu')).toHaveCount(0);
    });

    test('logged-in routes have no horizontal overflow', async ({ page }) => {
      const email = `mobile-${vp.width}-${Date.now()}@e2e.local`;
      await register(page, email);
      const waits = {
        '/studio': 'AI Upscaler Studio',
        '/profile': 'Profile',
        '/payment': 'Add credits',
      };
      for (const [route, heading] of Object.entries(waits)) {
        await page.goto(route);
        await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
        await expectNoOverflow(page);
      }
      // Credits are visible in the mobile menu (hidden desktop pill).
      await page.getByTestId('mobile-menu-button').click();
      await expect(page.getByTestId('mobile-menu-credits')).toContainText('credits');
    });

    test('admin route has no horizontal overflow', async ({ page }) => {
      await login(page, 'admin@e2e.local', 'AdminPass123');
      await page.goto('/admin');
      await expect(page.getByText('Admin dashboard')).toBeVisible();
      await expectNoOverflow(page);
    });

    test('studio upload staging works by tap at phone width', async ({ page }) => {
      const email = `stage-${vp.width}-${Date.now()}@e2e.local`;
      await register(page, email);
      await page.locator('input[type="file"]').first().setInputFiles(SAMPLE_PNG);
      await expect(page.getByRole('button', { name: /Enhance at/ })).toBeVisible();
      const h = await page.getByRole('button', { name: /Enhance at/ }).evaluate(
        (el) => el.getBoundingClientRect().height,
      );
      expect(h).toBeGreaterThanOrEqual(44);
      await expectNoOverflow(page);
    });

    test('compare slider divider moves by touch drag', async ({ page }) => {
      await page.goto('/');
      const slider = page.getByTestId('compare-slider');
      await expect(slider).toBeVisible();
      // The root must not let the page scroll while the divider is dragged.
      const touchAction = await slider.evaluate(
        (el) => getComputedStyle(el).touchAction,
      );
      expect(touchAction).toBe('none');
      const posBefore = await slider.evaluate((root) => {
        const divider = root.querySelector('[data-handle="true"]')?.parentElement;
        return divider ? parseFloat(divider.style.left) : NaN;
      });
      // CDP touch coordinates are viewport coordinates: the slider must be
      // scrolled into view first, otherwise the drag lands off-screen.
      await slider.scrollIntoViewIfNeeded();
      const box = await slider.boundingBox();
      const midY = box.y + box.height / 2;
      const fromX = box.x + (box.width * posBefore) / 100;
      await touchDrag(page, { x: fromX, y: midY }, { x: fromX + 60, y: midY });
      const posAfter = await slider.evaluate((root) => {
        const divider = root.querySelector('[data-handle="true"]')?.parentElement;
        return divider ? parseFloat(divider.style.left) : NaN;
      });
      expect(posAfter).toBeGreaterThan(posBefore + 5);
    });

    test('primary buttons meet the 44px touch target', async ({ page }) => {
      await page.goto('/login');
      const submit = page.getByRole('button', { name: 'Log in' });
      const h = await submit.evaluate((el) => el.getBoundingClientRect().height);
      expect(h).toBeGreaterThanOrEqual(44);
    });
  });
}
