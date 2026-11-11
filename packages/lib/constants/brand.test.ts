import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadBrandPack } from '../server-only/branding/load-brand-pack';
import { BRAND, BRAND_LEGAL_NAME, BRAND_NAME, IS_BRANDED } from './brand';

const writePack = (pack: unknown) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-pack-'));
  fs.mkdirSync(path.join(dir, 'public/brand'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'public/brand/brand.json'), JSON.stringify(pack));

  return dir;
};

const VALID_PACK = {
  name: 'Example Co',
  legalName: 'Example Co, Inc.',
  companyDetails: '1 Main Street, Springfield',
  emailColors: { primary: '#112233', primaryForeground: '#ffffff' },
};

describe('brand pack', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is unbranded with upstream names when no pack exists', () => {
    vi.stubEnv('NEXT_PUBLIC_BRAND', undefined);

    expect(loadBrandPack(fs.mkdtempSync(path.join(os.tmpdir(), 'no-pack-')))).toBeNull();
    expect(IS_BRANDED()).toBe(false);
    expect(BRAND_NAME()).toBe('Documenso');
    expect(BRAND_LEGAL_NAME()).toBe('Documenso, Inc.');
  });

  it('publishes a valid pack to the environment and the getters', () => {
    vi.stubEnv('NEXT_PUBLIC_BRAND', undefined);

    loadBrandPack(writePack(VALID_PACK));

    expect(IS_BRANDED()).toBe(true);
    expect(BRAND_NAME()).toBe('Example Co');
    expect(BRAND_LEGAL_NAME()).toBe('Example Co, Inc.');
    expect(BRAND()?.emailColors?.primary).toBe('#112233');
  });

  it('rejects a pack that carries a URL, naming the field', () => {
    expect(() => loadBrandPack(writePack({ ...VALID_PACK, companyDetails: 'see https://example.com' }))).toThrow(
      /companyDetails/,
    );
  });

  it('rejects a pack missing a required field, naming the field', () => {
    const { legalName: _legalName, ...withoutLegalName } = VALID_PACK;

    expect(() => loadBrandPack(writePack(withoutLegalName))).toThrow(/legalName/);
  });
});
