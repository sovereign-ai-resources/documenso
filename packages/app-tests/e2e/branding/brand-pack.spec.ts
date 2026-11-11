import { expect, type Page, test } from '@playwright/test';

// Runs only against a server started with a brand pack, like the paired skip in the access-code spec.
const BRANDED = process.env.E2E_BRANDED === 'true';
const NON_QR_SHARE_SLUG = 'brand-pack-e2e-slug';

test.skip(!BRANDED, 'Requires a branded build (E2E_BRANDED=true)');

const getBrandName = async (page: Page): Promise<string> => {
  const raw = await page.evaluate(
    () => (window as unknown as { __ENV__?: Record<string, string | undefined> }).__ENV__?.NEXT_PUBLIC_BRAND,
  );

  expect(raw, 'NEXT_PUBLIC_BRAND should be present in the page environment').toBeTruthy();

  return (JSON.parse(raw as string) as { name: string }).name;
};

const setTheme = async (page: Page, theme: 'light' | 'dark') => {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((value) => {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(value);
  }, theme);
};

const channels = (color: string): [number, number, number, number] => {
  const match = color.match(/rgba?\(([^)]+)\)/) ?? color.match(/color\(srgb ([^)]+)\)/);

  if (!match) {
    throw new Error(`Unparseable color: ${color}`);
  }

  const parts = match[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  const scale = color.startsWith('color(') ? 255 : 1;

  return [parts[0] * scale, parts[1] * scale, parts[2] * scale, parts[3] ?? 1];
};

const luminance = ([r, g, b]: [number, number, number, number]) => {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const s = v / 255;

    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
};

const contrast = (a: [number, number, number, number], b: [number, number, number, number]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (hi + 0.05) / (lo + 0.05);
};

test.describe('brand pack', () => {
  test('sign-in title ends with the brand name and shows the brand logo', async ({ page }) => {
    await page.goto('/signin');

    const brandName = await getBrandName(page);

    await expect(page).toHaveTitle(new RegExp(`${brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));

    await expect(page.locator(`img[alt="${brandName}"]`).first()).toBeAttached();
  });

  test('dark mode shows the dark logo variant and light mode the light one', async ({ page }) => {
    await page.goto('/signin');

    const brandName = await getBrandName(page);
    const logos = page.locator(`img[alt="${brandName}"]`);

    await setTheme(page, 'light');
    await expect(logos.filter({ visible: true }).first()).toHaveAttribute('src', /logo-light/);

    await setTheme(page, 'dark');
    await expect(logos.filter({ visible: true }).first()).toHaveAttribute('src', /logo-dark/);
  });

  test('declares a favicon and a manifest', async ({ page }) => {
    await page.goto('/signin');

    await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute('href', /favicon/);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /site\.webmanifest/);
  });

  test('a non-QR share slug redirects to the app root', async ({ page }) => {
    await page.goto(`/share/${NON_QR_SHARE_SLUG}`);

    await expect(page).toHaveURL(/\/(signin)?(\?.*)?$/);
    expect(new URL(page.url()).hostname).toBe(
      new URL(process.env.NEXT_PUBLIC_WEBAPP_URL || 'http://localhost:3000').hostname,
    );
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`primary link color meets 4.5:1 contrast in ${theme} mode`, async ({ page }) => {
      await page.goto('/signin');
      await setTheme(page, theme);

      const link = page.locator('a.text-documenso-700, a[href*="signup"]').first();
      await expect(link).toBeVisible();

      const { color, background } = await link.evaluate((el) => {
        let node: Element | null = el;
        let bg = 'rgba(0, 0, 0, 0)';

        while (node) {
          const value = getComputedStyle(node).backgroundColor;

          if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') {
            bg = value;
            break;
          }

          node = node.parentElement;
        }

        return { color: getComputedStyle(el).color, background: bg };
      });

      const bgChannels =
        background === 'rgba(0, 0, 0, 0)'
          ? ([255, 255, 255, 1] as [number, number, number, number])
          : channels(background);

      expect(contrast(channels(color), bgChannels)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
