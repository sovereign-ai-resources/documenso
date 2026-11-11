import { afterEach, describe, expect, it, vi } from 'vitest';

import { getBrandOrganisationSettings, shouldApplyBrand } from './apply-brand-to-organisation';

const defaults = { brandingEnabled: false, brandingLogo: '', brandingUrl: '', brandingCompanyDetails: '' };

describe('shouldApplyBrand', () => {
  it('fills settings still at upstream defaults', () => {
    expect(shouldApplyBrand({ settings: defaults, reapply: false })).toBe(true);
  });

  it('skips once branding is enabled', () => {
    expect(shouldApplyBrand({ settings: { ...defaults, brandingEnabled: true }, reapply: false })).toBe(false);
  });

  it('skips when an admin turned branding off but left a logo', () => {
    expect(shouldApplyBrand({ settings: { ...defaults, brandingLogo: '{"type":"BYTES_64"}' }, reapply: false })).toBe(
      false,
    );
  });

  it.each(['brandingUrl', 'brandingCompanyDetails'] as const)('skips when %s is set', (field) => {
    expect(shouldApplyBrand({ settings: { ...defaults, [field]: 'x' }, reapply: false })).toBe(false);
  });

  it('overwrites customized settings when reapply is requested', () => {
    expect(
      shouldApplyBrand({
        settings: { brandingEnabled: true, brandingLogo: 'x', brandingUrl: 'x', brandingCompanyDetails: 'x' },
        reapply: true,
      }),
    ).toBe(true);
  });
});

describe('getBrandOrganisationSettings', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Enabling branding switches the email footer to these company details, so
  // they must carry the legal name even when the pack has no details of its own.
  it('stores the legal name as company details when the pack has none', () => {
    vi.stubEnv('NEXT_PUBLIC_BRAND', JSON.stringify({ name: 'Example Co', legalName: 'Example Co, Inc.' }));
    vi.stubEnv('NEXT_PUBLIC_BRAND_WEBSITE_URL', 'https://example.com');

    expect(getBrandOrganisationSettings()).toEqual({
      brandingEnabled: true,
      brandingUrl: 'https://example.com',
      brandingCompanyDetails: 'Example Co, Inc.',
    });
  });
});
