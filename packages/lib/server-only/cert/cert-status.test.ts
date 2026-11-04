import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCertificateStatus } from './cert-status';

describe('getCertificateStatus', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports the Azure Key Vault transport as available, like the other remote transports', async () => {
    vi.stubEnv('NEXT_PRIVATE_SIGNING_TRANSPORT', 'azure-kv');

    await expect(getCertificateStatus()).resolves.toEqual({ isAvailable: true });
  });

  it('still reports an unknown transport as unavailable', async () => {
    vi.stubEnv('NEXT_PRIVATE_SIGNING_TRANSPORT', 'not-a-transport');

    await expect(getCertificateStatus()).resolves.toEqual({ isAvailable: false });
  });
});
