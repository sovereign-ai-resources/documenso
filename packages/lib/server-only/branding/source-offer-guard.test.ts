import { describe, expect, it } from 'vitest';

import { decideSourceOfferStartup } from './source-offer-guard';

const offer = {
  repositoryUrl: 'https://example.com/org/repo',
  commit: 'abc123',
  treeUrl: 'https://example.com/org/repo/tree/abc123',
};

describe('decideSourceOfferStartup', () => {
  it('starts when a branded build has a source offer', () => {
    expect(decideSourceOfferStartup({ isBranded: true, offer, allowMissing: false, env: {} })).toEqual({
      action: 'ok',
    });
  });

  it('refuses to start and names the missing commit', () => {
    const result = decideSourceOfferStartup({
      isBranded: true,
      offer: null,
      allowMissing: false,
      env: { NEXT_PUBLIC_SOURCE_REPOSITORY_URL: 'https://example.com/org/repo' },
    });

    expect(result.action).toBe('fail');
    expect(result).toMatchObject({ missing: ['NEXT_PUBLIC_SOURCE_COMMIT'] });
  });

  it('names both values when both are missing', () => {
    const result = decideSourceOfferStartup({ isBranded: true, offer: null, allowMissing: false, env: {} });

    expect(result).toMatchObject({
      action: 'fail',
      missing: ['NEXT_PUBLIC_SOURCE_REPOSITORY_URL', 'NEXT_PUBLIC_SOURCE_COMMIT'],
    });
  });

  it('warns and continues when the opt-out is set', () => {
    const result = decideSourceOfferStartup({ isBranded: true, offer: null, allowMissing: true, env: {} });

    expect(result.action).toBe('warn');
  });

  it('does not check an unbranded build', () => {
    expect(decideSourceOfferStartup({ isBranded: false, offer: null, allowMissing: false, env: {} })).toEqual({
      action: 'ok',
    });
  });
});
