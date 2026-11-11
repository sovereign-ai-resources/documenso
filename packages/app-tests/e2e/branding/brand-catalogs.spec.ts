import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { applyBrandToMessages } from '@documenso/lib/utils/brand-messages';
import { formatter } from '@lingui/format-po';
import { compileMessage } from '@lingui/message-utils/compileMessage';
import { expect, test } from '@playwright/test';

// Reads the shipped catalogs from disk, so it lives here rather than in Vitest,
// which is for pure functions only. It needs no server or browser.
const CREDIT = 'Based on Documenso (AGPL-3.0)';
const TRANSLATIONS_DIR = join(__dirname, '../../../lib/translations');

const containsProductName = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return value.replace(CREDIT, '').includes('Documenso');
  }

  if (value && typeof value === 'object') {
    return Object.values(value).some(containsProductName);
  }

  return false;
};

// Compile the way `lingui compile` does, so the transform sees the compiled
// string and array forms production loads rather than the raw `.po` text.
const compileLocale = (locale: string) => {
  const catalog = formatter({ lineNumbers: false }).parse(
    readFileSync(join(TRANSLATIONS_DIR, locale, 'web.po'), 'utf8'),
    { locale, sourceLocale: 'en', filename: 'web.po' },
  ) as Record<string, { translation?: string | null; message?: string | null }>;

  return Object.fromEntries(
    Object.entries(catalog).map(([id, item]) => [id, compileMessage(item.translation || item.message || id)]),
  );
};

const locales = readdirSync(TRANSLATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

test.describe('brand catalog transform', () => {
  const previous = process.env.NEXT_PUBLIC_BRAND;

  test.afterEach(() => {
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_BRAND;
    } else {
      process.env.NEXT_PUBLIC_BRAND = previous;
    }
  });

  test('finds the shipped locales', () => {
    expect(locales.length).toBeGreaterThan(0);
  });

  for (const locale of locales) {
    test(`${locale} has no product name left after the transform`, () => {
      const compiled = compileLocale(locale);

      expect(containsProductName(compiled)).toBe(true);

      process.env.NEXT_PUBLIC_BRAND = JSON.stringify({ name: 'Example Co', legalName: 'Example Co, Inc.' });

      expect(containsProductName(applyBrandToMessages(compiled))).toBe(false);
    });
  }
});
