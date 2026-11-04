import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { deleteDocument } from '@documenso/lib/server-only/document/delete-document';
import { createApiToken } from '@documenso/lib/server-only/public-api/create-api-token';
import { DOCUMENT_AUDIT_LOG_TYPE } from '@documenso/lib/types/document-audit-logs';
import { createDocumentAuditLogData } from '@documenso/lib/utils/document-audit-logs';
import { prisma } from '@documenso/prisma';
import { DocumentStatus, FieldType, SigningStatus, WebhookTriggerEvents } from '@documenso/prisma/client';
import { seedBlankDocument, seedPendingDocumentWithFullFields } from '@documenso/prisma/seed/documents';
import { seedUser } from '@documenso/prisma/seed/users';
import { PDF } from '@libpdf/core';
import { expect, test } from '@playwright/test';

// Deleting a pending document with NEXT_PRIVATE_PREVENT_PENDING_DELETE=true
// cancels it instead, keeping signatures and the audit trail. These tests call
// the delete function in this process, so the flag is set here rather than on
// the web server.

const requestMetadata = {
  auth: null,
  requestMetadata: {},
  source: 'app' as const,
};

const FLAG = 'NEXT_PRIVATE_PREVENT_PENDING_DELETE';

test.describe.configure({ mode: 'serial' });

const withFlag = async <T>(value: string | undefined, fn: () => Promise<T>) => {
  const previous = process.env[FLAG];

  if (value === undefined) {
    delete process.env[FLAG];
  } else {
    process.env[FLAG] = value;
  }

  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env[FLAG];
    } else {
      process.env[FLAG] = previous;
    }
  }
};

const seedPendingWithOneSignature = async () => {
  const { user: owner, team } = await seedUser();

  const { document, recipients } = await seedPendingDocumentWithFullFields({
    owner,
    recipients: ['first-signer@test.documenso.com', 'second-signer@test.documenso.com'],
    fields: [FieldType.SIGNATURE],
    teamId: team.id,
  });

  const [signedRecipient] = recipients;
  const signatureField = signedRecipient.fields[0];

  await prisma.field.update({
    where: { id: signatureField.id },
    data: {
      inserted: true,
      signature: {
        create: {
          recipientId: signedRecipient.id,
          typedSignature: 'First Signer',
        },
      },
    },
  });

  await prisma.recipient.update({
    where: { id: signedRecipient.id },
    data: { signingStatus: SigningStatus.SIGNED, signedAt: new Date() },
  });

  await prisma.documentAuditLog.create({
    data: createDocumentAuditLogData({
      envelopeId: document.id,
      type: DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_COMPLETED,
      data: {
        recipientEmail: signedRecipient.email,
        recipientName: signedRecipient.name,
        recipientId: signedRecipient.id,
        recipientRole: signedRecipient.role,
        actionAuth: [],
      },
    }),
  });

  const webhook = await prisma.webhook.create({
    data: {
      webhookUrl: 'https://webhook.example.invalid/',
      eventTriggers: [WebhookTriggerEvents.DOCUMENT_CANCELLED],
      enabled: true,
      userId: owner.id,
      teamId: team.id,
    },
  });

  return { owner, team, document, signedRecipient, webhook };
};

test('[PREVENT_PENDING_DELETE]: deleting a pending document cancels it and keeps its evidence', async () => {
  const { owner, team, document, signedRecipient, webhook } = await seedPendingWithOneSignature();

  const result = await withFlag('true', async () =>
    deleteDocument({
      id: { type: 'envelopeId', id: document.id },
      userId: owner.id,
      teamId: team.id,
      requestMetadata,
    }),
  );

  expect(result.status).toBe(DocumentStatus.CANCELLED);

  const envelope = await prisma.envelope.findUnique({ where: { id: document.id } });

  expect(envelope?.status).toBe(DocumentStatus.CANCELLED);
  expect(envelope?.deletedAt).toBeNull();

  const signatures = await prisma.signature.findMany({ where: { recipientId: signedRecipient.id } });
  expect(signatures).toHaveLength(1);

  const auditLogTypes = await prisma.documentAuditLog
    .findMany({ where: { envelopeId: document.id }, select: { type: true } })
    .then((logs) => logs.map((log) => log.type));

  expect(auditLogTypes).toContain(DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_COMPLETED);
  expect(auditLogTypes).toContain(DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_CANCELLED);
  expect(auditLogTypes).not.toContain(DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_DELETED);

  const webhookJobs = await prisma.backgroundJob.findMany({
    where: { jobId: 'internal.execute-webhook', payload: { path: ['webhookId'], equals: webhook.id } },
  });

  expect(webhookJobs).toHaveLength(1);
  expect(webhookJobs[0].payload).toMatchObject({ event: WebhookTriggerEvents.DOCUMENT_CANCELLED });
});

test('[PREVENT_PENDING_DELETE]: a draft is still deleted', async () => {
  const { user: owner, team } = await seedUser();
  const draft = await seedBlankDocument(owner, team.id);

  await withFlag('true', async () =>
    deleteDocument({
      id: { type: 'envelopeId', id: draft.id },
      userId: owner.id,
      teamId: team.id,
      requestMetadata,
    }),
  );

  expect(await prisma.envelope.findUnique({ where: { id: draft.id } })).toBeNull();
});

test('[PREVENT_PENDING_DELETE]: without the flag a pending document is hard-deleted as upstream', async () => {
  const { owner, team, document } = await seedPendingWithOneSignature();

  await withFlag(undefined, async () =>
    deleteDocument({
      id: { type: 'envelopeId', id: document.id },
      userId: owner.id,
      teamId: team.id,
      requestMetadata,
    }),
  );

  expect(await prisma.envelope.findUnique({ where: { id: document.id } })).toBeNull();
});

test('[PREVENT_PENDING_DELETE]: the audit log of a cancelled document is still downloadable', async ({ request }) => {
  const { owner, team, document } = await seedPendingWithOneSignature();

  await withFlag('true', async () =>
    deleteDocument({
      id: { type: 'envelopeId', id: document.id },
      userId: owner.id,
      teamId: team.id,
      requestMetadata,
    }),
  );

  const { token } = await createApiToken({
    userId: owner.id,
    teamId: team.id,
    tokenName: 'audit-log',
    expiresIn: null,
  });

  const response = await request.get(`${NEXT_PUBLIC_WEBAPP_URL()}/api/v2/envelope/${document.id}/audit-log/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/pdf');

  const pdf = await PDF.load(new Uint8Array(await response.body()));
  expect(pdf.getPageCount()).toBeGreaterThan(0);
});
