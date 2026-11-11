import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { IS_BRANDED } from '@documenso/lib/constants/brand';
import { loadBrandPack } from '@documenso/lib/server-only/branding/load-brand-pack';
import { expect, test } from '@playwright/test';

// Calls the startup loader against temp folders in this process; it reads the
// filesystem, so it lives here rather than in Vitest. It needs no server.
const PACK = { name: 'Example Co', legalName: 'Example Co, Inc.' };

const packDir = (pack?: object) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-pack-'));

  if (pack) {
    fs.mkdirSync(path.join(dir, 'public/brand'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'public/brand/brand.json'), JSON.stringify(pack));
  }

  return dir;
};

test.describe('loadBrandPack', () => {
  const previous = process.env.NEXT_PUBLIC_BRAND;

  test.afterEach(() => {
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_BRAND;
    } else {
      process.env.NEXT_PUBLIC_BRAND = previous;
    }
  });

  test('publishes a valid pack to the environment', () => {
    delete process.env.NEXT_PUBLIC_BRAND;

    expect(loadBrandPack(packDir(PACK))).toEqual(PACK);
    expect(JSON.parse(process.env.NEXT_PUBLIC_BRAND ?? 'null')).toEqual(PACK);
    expect(IS_BRANDED()).toBe(true);
  });

  // A brand set by hand without its pack would skip the source-offer startup check.
  test('clears a hand-set brand when the image has no pack', () => {
    process.env.NEXT_PUBLIC_BRAND = JSON.stringify(PACK);

    expect(loadBrandPack(packDir())).toBeNull();
    expect(process.env.NEXT_PUBLIC_BRAND).toBeUndefined();
    expect(IS_BRANDED()).toBe(false);
  });

  test('stops startup on an invalid pack, naming the field', () => {
    expect(() => loadBrandPack(packDir({ name: 'Example Co' }))).toThrow(/legalName/);
  });
});
