import { describe, expect, it } from 'vitest';

import { shouldApplyBrand } from './apply-brand-to-organisation';

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
