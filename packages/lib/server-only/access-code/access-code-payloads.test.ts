import { DocumentStatus, EnvelopeType, type Recipient } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { ZRecipientSchema } from '../../types/recipient';
import { mapEnvelopeToWebhookDocumentPayload } from '../../types/webhook-payload';
import { createAccessCodeState } from './access-code';

const SECRET = 'test-secret-value';

const makeAuthOptions = async () => ({
  accessAuth: ['ACCESS_CODE'],
  actionAuth: [],
  accessCode: await createAccessCodeState('k3x9p2', SECRET),
});

describe('stored access code never leaves the server', () => {
  it('is absent from webhook payload recipients', async () => {
    const authOptions = await makeAuthOptions();

    const payload = mapEnvelopeToWebhookDocumentPayload({
      id: 'envelope_1',
      secondaryId: 'document_1',
      type: EnvelopeType.DOCUMENT,
      status: DocumentStatus.PENDING,
      title: 'Agreement',
      authOptions: null,
      documentMeta: null,
      recipients: [
        { id: 1, email: 'signer@example.com', name: 'Signer', token: 'tok', authOptions } as unknown as Recipient,
      ],
      // biome-ignore lint/suspicious/noExplicitAny: only the fields the mapper reads matter here
    } as any);

    const body = JSON.stringify(payload);

    expect(payload.recipients[0].authOptions).toEqual({ accessAuth: ['ACCESS_CODE'], actionAuth: [] });
    expect(body).not.toContain(authOptions.accessCode.hash);
    expect(body).not.toContain(authOptions.accessCode.salt);
  });

  it('is absent from the API recipient response schema', async () => {
    const authOptions = await makeAuthOptions();

    expect(ZRecipientSchema.shape.authOptions.parse(authOptions)).toEqual({
      accessAuth: ['ACCESS_CODE'],
      actionAuth: [],
    });
  });
});
