import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCertificateStatus } from './cert-status';

// Self-signed RSA certificate valid until 2126; no private key exists for it.
const AZURE_KV_TEST_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDJzCCAg+gAwIBAgIUJt74hm9Yo+pGtQWtx0/lMQa2S6cwDQYJKoZIhvcNAQEL
BQAwIjEgMB4GA1UEAwwXQ2VydGlmaWNhdGUgU3RhdHVzIFRlc3QwIBcNMjYxMTA0
MjAwOTUzWhgPMjEyNjEwMTEyMDA5NTNaMCIxIDAeBgNVBAMMF0NlcnRpZmljYXRl
IFN0YXR1cyBUZXN0MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvdgM
8Cf2YmqRjxDD/joNc4+t5IeJwf+wJh8cfndveGhDq6H6iFMQJlYKFLQjssrw1vym
H/h1QZBNiYsFDYiAY7PmPoE7/+ZhqrpfG19IXzRzXqJukdP0sksQoyPk5vnoJSUo
Vw53Vbwhhlh5ksK9RlKzI8PKus2NdcgRtFUXlJ1XhH2JERpemxKdCu1yY1AmZXRJ
GKteFyzlJJUR1RwUdWRDLP/fcCGYAtZLrFH79LlPtN4utXTF+g6WwCgOHARVYrFe
YVbqnugNURjxuA3QmQsHWN032QFqRZih/12zfnGChgu3PWwAscRXLwretHv7lv3U
z5DItEshRUwtpyTccQIDAQABo1MwUTAdBgNVHQ4EFgQUf1daVmJdHS+EHj36mSSa
4b8t3PswHwYDVR0jBBgwFoAUf1daVmJdHS+EHj36mSSa4b8t3PswDwYDVR0TAQH/
BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAioeAvTtnh+59mO/3i4iWKkIK592v
Jvb+9oIQ0IJ1pHLWp04Gidzs9iMc1ASKAV7cxJqOikyOQEqZpirTioJAZFkEPDws
JLTVfYfV3ojw00Yhs36zrDU+utDsPsAoi3F6tyPpHGZj8lCrIzH9xXhgQ5bvVx6F
sQgJvAnr865iY0DY5EazqRUKg6wtxCNZTaziS60o2Xk9w7txvtRNdhGGr5A6cvHl
YsfiTOAWT/WiXXBx3ALSe1DjMknFyfG8qkvNSpAZSX7PJKwUWTNwYQwrdsTyPjox
RrmTnzVwQ+CM9lZ0QetjSY0xw486anDHl55+ROaf68lcsQhHRWxYgvKadw==
-----END CERTIFICATE-----`;

describe('getCertificateStatus', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports the Azure Key Vault transport as available when its configuration is complete', async () => {
    vi.stubEnv('NEXT_PRIVATE_SIGNING_TRANSPORT', 'azure-kv');
    vi.stubEnv('NEXT_PRIVATE_SIGNING_AZURE_KV_KEY_ID', 'https://example-vault.vault.azure.net/keys/signing-key/0123');
    vi.stubEnv('NEXT_PRIVATE_SIGNING_AZURE_KV_CERT_CHAIN', AZURE_KV_TEST_CERTIFICATE);

    await expect(getCertificateStatus()).resolves.toEqual({ isAvailable: true });
  });

  it('reports the Azure Key Vault transport as unavailable when its certificate chain is missing', async () => {
    vi.stubEnv('NEXT_PRIVATE_SIGNING_TRANSPORT', 'azure-kv');
    vi.stubEnv('NEXT_PRIVATE_SIGNING_AZURE_KV_KEY_ID', 'https://example-vault.vault.azure.net/keys/signing-key/0123');
    vi.stubEnv('NEXT_PRIVATE_SIGNING_AZURE_KV_CERT_CHAIN', '');

    await expect(getCertificateStatus()).resolves.toEqual({ isAvailable: false });
  });

  it('still reports an unknown transport as unavailable', async () => {
    vi.stubEnv('NEXT_PRIVATE_SIGNING_TRANSPORT', 'not-a-transport');

    await expect(getCertificateStatus()).resolves.toEqual({ isAvailable: false });
  });
});
