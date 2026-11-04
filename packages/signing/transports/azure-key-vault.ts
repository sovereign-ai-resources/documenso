import { createHash, verify, X509Certificate } from 'node:crypto';

import { env } from '@documenso/lib/utils/env';
import type { DigestAlgorithm, Signer } from '@libpdf/core';
import { parsePem } from '@libpdf/core';

export type AzureKeyVaultCryptographyClient = {
  sign: (algorithm: string, digest: Uint8Array) => Promise<{ result: Uint8Array }>;
};

export type CreateAzureKeyVaultSignerOptions = {
  createCryptographyClient?: (
    keyId: string,
  ) => AzureKeyVaultCryptographyClient | Promise<AzureKeyVaultCryptographyClient>;
};

const KEY_VAULT_RSA_ALGORITHMS: Record<DigestAlgorithm, { keyVault: string; nodeHash: string }> = {
  'SHA-256': { keyVault: 'RS256', nodeHash: 'sha256' },
  'SHA-384': { keyVault: 'RS384', nodeHash: 'sha384' },
  'SHA-512': { keyVault: 'RS512', nodeHash: 'sha512' },
};

const PEM_HEADER = '-----BEGIN';

const decodePemOrBase64Pem = (value: string) =>
  value.includes(PEM_HEADER) ? value : Buffer.from(value, 'base64').toString('utf-8');

const loadCertificates = (): Uint8Array[] => {
  const chain = env('NEXT_PRIVATE_SIGNING_AZURE_KV_CERT_CHAIN');

  if (!chain) {
    throw new Error('NEXT_PRIVATE_SIGNING_AZURE_KV_CERT_CHAIN is required for Azure Key Vault signing');
  }

  const certificates = parsePem(decodePemOrBase64Pem(chain))
    .filter((block) => block.label === 'CERTIFICATE')
    .map((block) => block.der);

  if (certificates.length === 0) {
    throw new Error('NEXT_PRIVATE_SIGNING_AZURE_KV_CERT_CHAIN contains no PEM certificates');
  }

  return certificates;
};

const getRsaPublicKey = (certificate: Uint8Array) => {
  const { publicKey } = new X509Certificate(certificate);

  if (publicKey.asymmetricKeyType !== 'rsa') {
    throw new Error(
      `Azure Key Vault signing supports RSA keys only, but the signing certificate in NEXT_PRIVATE_SIGNING_AZURE_KV_CERT_CHAIN has a ${publicKey.asymmetricKeyType?.toUpperCase() ?? 'unknown'} key`,
    );
  }

  return publicKey;
};

/**
 * Reads and checks the azure-kv configuration without contacting Key Vault.
 */
export const loadAzureKeyVaultSigningConfig = () => {
  const keyId = env('NEXT_PRIVATE_SIGNING_AZURE_KV_KEY_ID');

  if (!keyId) {
    throw new Error('NEXT_PRIVATE_SIGNING_AZURE_KV_KEY_ID is required for Azure Key Vault signing');
  }

  const [certificate, ...certificateChain] = loadCertificates();

  const publicKey = getRsaPublicKey(certificate);

  return { keyId, certificate, certificateChain, publicKey };
};

const createDefaultCryptographyClient = async (keyId: string): Promise<AzureKeyVaultCryptographyClient> => {
  // Loaded on demand so instances using another transport never load the Azure SDK.
  const [{ CryptographyClient }, { DefaultAzureCredential }] = await Promise.all([
    import('@azure/keyvault-keys'),
    import('@azure/identity'),
  ]);

  const managedIdentityClientId = env('NEXT_PRIVATE_SIGNING_AZURE_KV_CLIENT_ID');

  const credential = new DefaultAzureCredential(managedIdentityClientId ? { managedIdentityClientId } : undefined);

  return new CryptographyClient(keyId, credential);
};

export const createAzureKeyVaultSigner = async ({
  createCryptographyClient = createDefaultCryptographyClient,
}: CreateAzureKeyVaultSignerOptions = {}): Promise<Signer> => {
  const { keyId, certificate, certificateChain, publicKey } = loadAzureKeyVaultSigningConfig();

  const client = await createCryptographyClient(keyId);

  return {
    certificate,
    certificateChain: certificateChain.length > 0 ? certificateChain : undefined,
    keyType: 'RSA',
    signatureAlgorithm: 'RSASSA-PKCS1-v1_5',
    sign: async (data: Uint8Array, algorithm: DigestAlgorithm) => {
      const { keyVault, nodeHash } = KEY_VAULT_RSA_ALGORITHMS[algorithm];

      const digest = new Uint8Array(createHash(nodeHash).update(data).digest());

      const { result } = await client.sign(keyVault, digest);

      // A key that does not match the certificate yields a signature no reader can validate.
      if (!verify(nodeHash, data, publicKey, result)) {
        throw new Error(
          'The Azure Key Vault signature does not verify against the signing certificate: NEXT_PRIVATE_SIGNING_AZURE_KV_KEY_ID does not name the key for the certificate in NEXT_PRIVATE_SIGNING_AZURE_KV_CERT_CHAIN',
        );
      }

      return result;
    },
  };
};
