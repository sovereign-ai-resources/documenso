import { createHash, X509Certificate } from 'node:crypto';

import { env } from '@documenso/lib/utils/env';
import type { DigestAlgorithm, Signer } from '@libpdf/core';
import { parsePem } from '@libpdf/core';

/**
 * The part of `@azure/keyvault-keys`' `CryptographyClient` this transport
 * uses. Key Vault signs a digest that is computed locally, so the document
 * never leaves the process and the private key never leaves the vault.
 */
export type AzureKeyVaultCryptographyClient = {
  sign: (algorithm: string, digest: Uint8Array) => Promise<{ result: Uint8Array }>;
};

export type CreateAzureKeyVaultSignerOptions = {
  /**
   * Builds the client for the given key identifier. Defaults to a real
   * `CryptographyClient` authenticated with `DefaultAzureCredential`.
   */
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

const loadCertificates = (): Uint8Array[] => {
  const chain = env('NEXT_PRIVATE_SIGNING_AZURE_KV_CERT_CHAIN');

  if (!chain) {
    throw new Error('NEXT_PRIVATE_SIGNING_AZURE_KV_CERT_CHAIN is required for Azure Key Vault signing');
  }

  // Accept the PEM chain as-is, or base64-encoded like the other transports'
  // *_CONTENTS variables, so it survives environments that mangle newlines.
  const pem = chain.includes(PEM_HEADER) ? chain : Buffer.from(chain, 'base64').toString('utf-8');

  const certificates = parsePem(pem)
    .filter((block) => block.label === 'CERTIFICATE')
    .map((block) => block.der);

  if (certificates.length === 0) {
    throw new Error('NEXT_PRIVATE_SIGNING_AZURE_KV_CERT_CHAIN contains no PEM certificates');
  }

  return certificates;
};

const assertRsaCertificate = (certificate: Uint8Array) => {
  const keyType = new X509Certificate(certificate).publicKey.asymmetricKeyType;

  if (keyType !== 'rsa') {
    throw new Error(
      `Azure Key Vault signing supports RSA keys only, but the signing certificate in NEXT_PRIVATE_SIGNING_AZURE_KV_CERT_CHAIN has a ${keyType?.toUpperCase() ?? 'unknown'} key`,
    );
  }
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
  const keyId = env('NEXT_PRIVATE_SIGNING_AZURE_KV_KEY_ID');

  if (!keyId) {
    throw new Error('NEXT_PRIVATE_SIGNING_AZURE_KV_KEY_ID is required for Azure Key Vault signing');
  }

  const [certificate, ...certificateChain] = loadCertificates();

  assertRsaCertificate(certificate);

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

      return result;
    },
  };
};
