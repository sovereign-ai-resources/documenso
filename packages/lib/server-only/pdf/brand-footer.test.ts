import { afterEach, describe, expect, it, vi } from 'vitest';

import { shouldShowPoweredByBlock } from './brand-footer';

describe('shouldShowPoweredByBlock', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const stubBrand = () => {
    vi.stubEnv('NEXT_PUBLIC_BRAND', JSON.stringify({ name: 'Example Co', legalName: 'Example Co, Inc.' }));
  };

  it('shows the block when branded and no flags are set', () => {
    stubBrand();

    expect(shouldShowPoweredByBlock({ hidePoweredBy: false })).toBe(true);
  });

  it('shows the block when branded even if the claim hides it', () => {
    stubBrand();

    expect(shouldShowPoweredByBlock({ hidePoweredBy: true })).toBe(true);
  });

  it('hides the block when unbranded and the claim hides it', () => {
    expect(shouldShowPoweredByBlock({ hidePoweredBy: true })).toBe(false);
  });

  it('shows the block when unbranded and no flags are set', () => {
    expect(shouldShowPoweredByBlock({ hidePoweredBy: false })).toBe(true);
  });

  it('treats an undefined flag as not hidden', () => {
    expect(shouldShowPoweredByBlock({ hidePoweredBy: undefined })).toBe(true);
  });
});
