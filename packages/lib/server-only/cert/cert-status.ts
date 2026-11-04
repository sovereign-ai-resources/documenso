import { X509Certificate } from 'node:crypto';

import { loadAzureKeyVaultSigningConfig } from '@documenso/signing/transports/azure-key-vault';
import { createLocalSigner } from '@documenso/signing/transports/local';

import { NEXT_PRIVATE_SIGNING_TRANSPORT } from '../../constants/app';

/**
 * Whether the local P12 opens with the configured passphrase, or the azure-kv
 * configuration parses, and the signing certificate is in date. Skips AIA and
 * Key Vault so this stays offline. gcloud-hsm and csc always report available.
 */
export const getCertificateStatus = async () => {
  const transport = NEXT_PRIVATE_SIGNING_TRANSPORT();

  // Cannot inspect a remote HSM or CSC provider from this process.
  if (transport === 'gcloud-hsm' || transport === 'csc') {
    return { isAvailable: true };
  }

  // Anything else (typo, leftover `http`) would throw at seal time.
  if (transport !== 'local' && transport !== 'azure-kv') {
    return { isAvailable: false };
  }

  try {
    const { certificate: certificateDer } =
      transport === 'azure-kv' ? loadAzureKeyVaultSigningConfig() : await createLocalSigner({ buildChain: false });

    const certificate = new X509Certificate(Buffer.from(certificateDer));

    const now = new Date();

    const isWithinValidityPeriod = new Date(certificate.validFrom) <= now && now <= new Date(certificate.validTo);

    return { isAvailable: isWithinValidityPeriod };
  } catch {
    return { isAvailable: false };
  }
};
