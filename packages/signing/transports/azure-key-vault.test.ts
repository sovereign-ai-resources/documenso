import { createHash, createPrivateKey, constants as cryptoConstants, privateEncrypt, webcrypto } from 'node:crypto';

import { PDF } from '@libpdf/core';
import * as x509 from '@peculiar/x509';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AzureKeyVaultCryptographyClient } from './azure-key-vault';
import { createAzureKeyVaultSigner } from './azure-key-vault';

const KEY_ID = 'https://example-vault.vault.azure.net/keys/signing-key/0123456789abcdef';

const DIGEST_INFO_PREFIX: Record<string, string> = {
  RS256: '3031300d060960864801650304020105000420',
  RS384: '3041300d060960864801650304020205000430',
  RS512: '3051300d060960864801650304020305000440',
};

type TestIdentity = {
  certificatePem: string;
  certificateDer: Uint8Array;
  privateKeyPkcs8: Uint8Array;
};

const createSelfSignedIdentity = async (algorithm: RsaHashedKeyGenParams | EcKeyGenParams): Promise<TestIdentity> => {
  x509.cryptoProvider.set(webcrypto as unknown as Crypto);

  const keys = (await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify'])) as CryptoKeyPair;

  const signingAlgorithm = algorithm.name === 'ECDSA' ? { name: 'ECDSA', hash: 'SHA-256' } : algorithm;

  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=Azure Key Vault Transport Test',
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
    signingAlgorithm,
    keys,
  });

  const privateKeyPkcs8 = new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey));

  return {
    certificatePem: certificate.toString('pem'),
    certificateDer: new Uint8Array(certificate.rawData),
    privateKeyPkcs8,
  };
};

const createFakeKeyVaultClient = (privateKeyPkcs8: Uint8Array) => {
  const privateKey = createPrivateKey({ key: Buffer.from(privateKeyPkcs8), format: 'der', type: 'pkcs8' });

  const sign = vi.fn((algorithm: string, digest: Uint8Array) => {
    const digestInfo = Buffer.concat([Buffer.from(DIGEST_INFO_PREFIX[algorithm], 'hex'), Buffer.from(digest)]);

    const result = new Uint8Array(
      privateEncrypt({ key: privateKey, padding: cryptoConstants.RSA_PKCS1_PADDING }, digestInfo),
    );

    return Promise.resolve({ result, algorithm, keyID: KEY_ID });
  });

  return { sign } satisfies AzureKeyVaultCryptographyClient;
};

const createSmallPdf = async () => {
  const pdf = PDF.create();
  pdf.addPage();

  return await PDF.load(await pdf.save());
};

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

const verifyPdfSignature = async (signedPdf: Uint8Array) => {
  pkijs.setEngine('node-webcrypto', new pkijs.CryptoEngine({ name: 'node-webcrypto', crypto: webcrypto as Crypto }));

  const text = latin1(signedPdf);

  const byteRangeMatch = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text);

  if (!byteRangeMatch) {
    throw new Error('Signed PDF has no ByteRange');
  }

  const [start1, length1, start2, length2] = byteRangeMatch.slice(1).map(Number);

  const contentsHex = text.slice(start1 + length1 + 1, start2 - 1);
  const cmsDer = Buffer.from(contentsHex, 'hex');

  const signedBytes = Buffer.concat([
    Buffer.from(signedPdf.subarray(start1, start1 + length1)),
    Buffer.from(signedPdf.subarray(start2, start2 + length2)),
  ]);

  const asn1 = asn1js.fromBER(new Uint8Array(cmsDer).buffer);
  const contentInfo = new pkijs.ContentInfo({ schema: asn1.result });
  const signedData = new pkijs.SignedData({ schema: contentInfo.content });

  const verified = await signedData.verify({
    signer: 0,
    data: new Uint8Array(signedBytes).buffer,
    checkChain: false,
  });

  const certificate = signedData.certificates?.[0];

  if (!(certificate instanceof pkijs.Certificate)) {
    throw new Error('CMS carries no signer certificate');
  }

  return {
    verified,
    signerCertificateDer: new Uint8Array(certificate.toSchema().toBER(false)),
  };
};

describe('createAzureKeyVaultSigner', () => {
  let rsaIdentity: TestIdentity;
  let otherRsaIdentity: TestIdentity;
  let ecIdentity: TestIdentity;

  beforeAll(async () => {
    rsaIdentity = await createSelfSignedIdentity({
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    });

    otherRsaIdentity = await createSelfSignedIdentity({
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    });

    ecIdentity = await createSelfSignedIdentity({ name: 'ECDSA', namedCurve: 'P-256' });
  });

  beforeEach(() => {
    vi.stubEnv('NEXT_PRIVATE_SIGNING_AZURE_KV_KEY_ID', KEY_ID);
    vi.stubEnv('NEXT_PRIVATE_SIGNING_AZURE_KV_CERT_CHAIN', rsaIdentity.certificatePem);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sends the SHA-256 digest of the input to Key Vault and returns its signature unchanged', async () => {
    const keyVault = createFakeKeyVaultClient(rsaIdentity.privateKeyPkcs8);
    const createCryptographyClient = vi.fn(() => keyVault);

    const signer = await createAzureKeyVaultSigner({ createCryptographyClient });

    const input = new TextEncoder().encode('signed attributes');
    const output = await signer.sign(input, 'SHA-256');

    expect(createCryptographyClient).toHaveBeenCalledWith(KEY_ID);
    expect(keyVault.sign).toHaveBeenCalledTimes(1);

    const [algorithm, digest] = keyVault.sign.mock.calls[0];
    const { result } = await keyVault.sign.mock.results[0].value;

    expect(algorithm).toBe('RS256');
    expect(Buffer.from(digest)).toEqual(createHash('sha256').update(input).digest());
    expect(output).toBe(result);
  });

  it('describes itself as an RSA PKCS#1 v1.5 signer with the leaf certificate first', async () => {
    const signer = await createAzureKeyVaultSigner({
      createCryptographyClient: () => createFakeKeyVaultClient(rsaIdentity.privateKeyPkcs8),
    });

    expect(signer.keyType).toBe('RSA');
    expect(signer.signatureAlgorithm).toBe('RSASSA-PKCS1-v1_5');
    expect(Buffer.from(signer.certificate)).toEqual(Buffer.from(rsaIdentity.certificateDer));
    expect(signer.certificateChain).toBeUndefined();
  });

  it('accepts the chain as base64-encoded PEM and keeps the issuers after the leaf', async () => {
    const chainPem = `${rsaIdentity.certificatePem}\n${ecIdentity.certificatePem}`;
    vi.stubEnv('NEXT_PRIVATE_SIGNING_AZURE_KV_CERT_CHAIN', Buffer.from(chainPem).toString('base64'));

    const signer = await createAzureKeyVaultSigner({
      createCryptographyClient: () => createFakeKeyVaultClient(rsaIdentity.privateKeyPkcs8),
    });

    expect(Buffer.from(signer.certificate)).toEqual(Buffer.from(rsaIdentity.certificateDer));
    expect(signer.certificateChain?.map((der) => Buffer.from(der))).toEqual([Buffer.from(ecIdentity.certificateDer)]);
  });

  it('produces a PDF signature that verifies against the certificate', async () => {
    const keyVault = createFakeKeyVaultClient(rsaIdentity.privateKeyPkcs8);

    const signer = await createAzureKeyVaultSigner({ createCryptographyClient: () => keyVault });

    const pdf = await createSmallPdf();
    const { bytes } = await pdf.sign({ signer, subFilter: 'ETSI.CAdES.detached' });

    const { verified, signerCertificateDer } = await verifyPdfSignature(bytes);

    expect(keyVault.sign).toHaveBeenCalled();
    expect(verified).toBe(true);
    expect(Buffer.from(signerCertificateDer)).toEqual(Buffer.from(rsaIdentity.certificateDer));
  });

  it('fails signer creation naming the key ID variable when it is missing', async () => {
    vi.stubEnv('NEXT_PRIVATE_SIGNING_AZURE_KV_KEY_ID', '');

    await expect(createAzureKeyVaultSigner({ createCryptographyClient: vi.fn() })).rejects.toThrow(
      'NEXT_PRIVATE_SIGNING_AZURE_KV_KEY_ID',
    );
  });

  it('fails signer creation naming the certificate chain variable when it is missing', async () => {
    vi.stubEnv('NEXT_PRIVATE_SIGNING_AZURE_KV_CERT_CHAIN', '');

    await expect(createAzureKeyVaultSigner({ createCryptographyClient: vi.fn() })).rejects.toThrow(
      'NEXT_PRIVATE_SIGNING_AZURE_KV_CERT_CHAIN',
    );
  });

  it('rejects an EC key', async () => {
    vi.stubEnv('NEXT_PRIVATE_SIGNING_AZURE_KV_CERT_CHAIN', ecIdentity.certificatePem);

    await expect(createAzureKeyVaultSigner({ createCryptographyClient: vi.fn() })).rejects.toThrow(/RSA/);
  });

  it('fails the seal when the Key Vault key does not match the certificate', async () => {
    const signer = await createAzureKeyVaultSigner({
      createCryptographyClient: () => createFakeKeyVaultClient(otherRsaIdentity.privateKeyPkcs8),
    });

    const pdf = await createSmallPdf();

    await expect(pdf.sign({ signer, subFilter: 'ETSI.CAdES.detached' })).rejects.toThrow(
      /NEXT_PRIVATE_SIGNING_AZURE_KV_KEY_ID.*NEXT_PRIVATE_SIGNING_AZURE_KV_CERT_CHAIN/,
    );
  });

  it('fails the seal when Key Vault returns a server error', async () => {
    const serverError = Object.assign(new Error('Service Unavailable'), { statusCode: 503 });

    const signer = await createAzureKeyVaultSigner({
      createCryptographyClient: () => ({ sign: vi.fn().mockRejectedValue(serverError) }),
    });

    const pdf = await createSmallPdf();

    await expect(pdf.sign({ signer, subFilter: 'ETSI.CAdES.detached' })).rejects.toThrow('Service Unavailable');
  });
});
