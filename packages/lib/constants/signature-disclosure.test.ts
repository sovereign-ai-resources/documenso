import { afterEach, describe, expect, it, vi } from 'vitest';

import { SIGNATURE_DISCLOSURE_URL } from './signature-disclosure';

describe('SIGNATURE_DISCLOSURE_URL', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to the built-in disclosure page', () => {
    vi.stubEnv('NEXT_PUBLIC_SIGNATURE_DISCLOSURE_URL', undefined);

    expect(SIGNATURE_DISCLOSURE_URL()).toBe('/articles/signature-disclosure');
  });

  it('uses the built-in page for a blank value', () => {
    vi.stubEnv('NEXT_PUBLIC_SIGNATURE_DISCLOSURE_URL', '  ');

    expect(SIGNATURE_DISCLOSURE_URL()).toBe('/articles/signature-disclosure');
  });

  it('uses the configured disclosure URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SIGNATURE_DISCLOSURE_URL', 'https://example.com/disclosure/v2');

    expect(SIGNATURE_DISCLOSURE_URL()).toBe('https://example.com/disclosure/v2');
  });
});
