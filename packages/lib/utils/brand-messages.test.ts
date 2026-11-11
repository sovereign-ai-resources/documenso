import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { formatter } from '@lingui/format-po';
import { compileMessage } from '@lingui/message-utils/compileMessage';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyBrandToMessages } from './brand-messages';

const CREDIT = 'Based on Documenso (AGPL-3.0)';

const brand = () =>
  vi.stubEnv('NEXT_PUBLIC_BRAND', JSON.stringify({ name: 'Example Co', legalName: 'Example Co, Inc.' }));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('applyBrandToMessages', () => {
  it('replaces the product name in a string message', () => {
    brand();

    const result = applyBrandToMessages({ a: 'Sign in to Documenso', b: "Documenso's inbox" });

    expect(result).toEqual({ a: 'Sign in to Example Co', b: "Example Co's inbox" });
  });

  it('replaces text parts of an array message and keeps placeholders', () => {
    brand();

    const result = applyBrandToMessages({
      a: ['Welcome to Documenso, ', ['name'], '! Open Documenso now.'],
    });

    expect(result.a).toEqual(['Welcome to Example Co, ', ['name'], '! Open Example Co now.']);
  });

  it('replaces text inside plural options', () => {
    brand();

    const result = applyBrandToMessages({
      a: [['count', 'plural', { one: ['#', ' Documenso'], other: ['#', ' Documenso docs'] }]],
    });

    expect(result.a).toEqual([['count', 'plural', { one: ['#', ' Example Co'], other: ['#', ' Example Co docs'] }]]);
  });

  it('leaves messages without the name unchanged', () => {
    brand();

    const messages = { a: 'Hello', b: ['Hi ', ['name']] };

    expect(applyBrandToMessages(messages)).toEqual(messages);
  });

  it('does not touch lowercase names inside URLs or addresses', () => {
    brand();

    const messages = { a: 'See https://documenso.com/docs or help@documenso.com' };

    expect(applyBrandToMessages(messages)).toEqual(messages);
  });

  it('leaves the credit string unchanged', () => {
    brand();

    const result = applyBrandToMessages({ a: CREDIT, b: [CREDIT] });

    expect(result).toEqual({ a: CREDIT, b: [CREDIT] });
  });

  it('passes catalogs through untouched when unbranded', () => {
    const messages = { a: 'Sign in to Documenso' };

    expect(applyBrandToMessages(messages)).toEqual(messages);
  });
});

const containsProductName = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return value.replace(CREDIT, '').includes('Documenso');
  }

  if (Array.isArray(value)) {
    return value.some(containsProductName);
  }

  if (value && typeof value === 'object') {
    return Object.values(value).some(containsProductName);
  }

  return false;
};

describe('every shipped locale', () => {
  const translationsDir = join(__dirname, '../translations');
  const locales = readdirSync(translationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  // Compile the same way `lingui compile` does, so the transform sees the compiled
  // string and array forms production loads rather than the raw `.po` text.
  const compileLocale = (locale: string) => {
    const catalog = formatter({ lineNumbers: false }).parse(
      readFileSync(join(translationsDir, locale, 'web.po'), 'utf8'),
      { locale, sourceLocale: 'en', filename: 'web.po' },
    ) as Record<string, { translation?: string | null; message?: string | null }>;

    return Object.fromEntries(
      Object.entries(catalog).map(([id, item]) => [id, compileMessage(item.translation || item.message || id)]),
    );
  };

  it('finds the shipped locales', () => {
    expect(locales.length).toBeGreaterThan(0);
  });

  it.each(locales)('%s has no product name left after the transform', (locale) => {
    const compiled = compileLocale(locale);

    expect(containsProductName(compiled)).toBe(true);

    brand();

    expect(containsProductName(applyBrandToMessages(compiled))).toBe(false);
  });
});
