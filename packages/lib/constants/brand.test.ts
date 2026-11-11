import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseBrandPack } from '../server-only/branding/load-brand-pack';
import { BRAND, BRAND_FOOTER_TEXT, BRAND_LEGAL_NAME, BRAND_NAME, IS_BRANDED } from './brand';
import { DEFAULT_BRAND_COLORS, getDefaultBrandColors } from './theme';

const VALID_PACK = {
  name: 'Example Co',
  legalName: 'Example Co, Inc.',
  companyDetails: '1 Main Street, Springfield',
  emailColors: { primary: '#112233', primaryForeground: '#ffffff' },
};

const brand = (pack: object) => vi.stubEnv('NEXT_PUBLIC_BRAND', JSON.stringify(pack));

describe('brand pack', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is unbranded with upstream names and colors when no pack is published', () => {
    vi.stubEnv('NEXT_PUBLIC_BRAND', undefined);

    expect(IS_BRANDED()).toBe(false);
    expect(BRAND_NAME()).toBe('Documenso');
    expect(BRAND_LEGAL_NAME()).toBe('Documenso, Inc.');
    expect(getDefaultBrandColors()).toEqual(DEFAULT_BRAND_COLORS);
  });

  it('exposes a published pack through the getters and overlays its email colors', () => {
    brand(VALID_PACK);

    expect(IS_BRANDED()).toBe(true);
    expect(BRAND_NAME()).toBe('Example Co');
    expect(BRAND()?.emailColors?.primary).toBe('#112233');
    expect(getDefaultBrandColors()).toEqual({
      ...DEFAULT_BRAND_COLORS,
      primary: '#112233',
      primaryForeground: '#ffffff',
    });
  });

  it('puts the legal name first in the footer text, with or without company details', () => {
    brand(VALID_PACK);
    expect(BRAND_FOOTER_TEXT()).toBe('Example Co, Inc.\n1 Main Street, Springfield');

    const { companyDetails: _companyDetails, ...withoutDetails } = VALID_PACK;
    brand(withoutDetails);
    expect(BRAND_FOOTER_TEXT()).toBe('Example Co, Inc.');
  });

  it('rejects a pack that carries a URL, naming the field', () => {
    const pack = JSON.stringify({ ...VALID_PACK, companyDetails: 'see https://example.com' });

    expect(() => parseBrandPack(pack, 'x')).toThrow(/companyDetails/);
  });

  it('rejects a pack missing a required field, naming the field', () => {
    const { legalName: _legalName, ...withoutLegalName } = VALID_PACK;

    expect(() => parseBrandPack(JSON.stringify(withoutLegalName), 'x')).toThrow(/legalName/);
  });
});
