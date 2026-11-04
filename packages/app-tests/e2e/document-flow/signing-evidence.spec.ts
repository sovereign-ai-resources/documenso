import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { sendDocument } from '@documenso/lib/server-only/document/send-document';
import { createApiToken } from '@documenso/lib/server-only/public-api/create-api-token';
import { DOCUMENT_AUDIT_LOG_TYPE } from '@documenso/lib/types/document-audit-logs';
import { getEnvelopeItemPdfUrl } from '@documenso/lib/utils/envelope-download';
import { prisma } from '@documenso/prisma';
import { DocumentStatus, FieldType, Prisma, SigningStatus } from '@documenso/prisma/client';
import { seedDraftDocument } from '@documenso/prisma/seed/documents';
import { seedUser } from '@documenso/prisma/seed/users';
import { expect, test } from '@playwright/test';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import { signSignaturePad } from '../fixtures/signature';

/**
 * Electronic signing evidence: completes a document as an unauthenticated
 * signer and checks what the record proves.
 *
 * - Consent: the signature disclosure is shown in the dialog that holds the
 *   final "Sign" button, and nothing is recorded as signed until it is pressed.
 * - Certificate of completion (appended to the signed PDF): signer name and
 *   email, authentication level, sent / viewed / signed timestamps, IP address
 *   and device.
 * - Audit log PDF: signer email, IP address, user agent, completion event.
 * - Tamper evidence: the sealed PDF carries a digital signature whose byte
 *   range covers the whole file except the signature value itself, so the
 *   signature's embedded document digest covers every other byte.
 */

const SIGNER_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) EvidenceCheck/1.0';

// The app reads the client IP only from proxy headers (X-Forwarded-For and
// similar), so the test plays the reverse proxy and supplies one.
const SIGNER_IP = '203.0.113.7';

test.use({ userAgent: SIGNER_USER_AGENT, extraHTTPHeaders: { 'X-Forwarded-For': SIGNER_IP } });

const extractPdfText = async (data: Uint8Array) => {
  const pdf = await pdfjsLib.getDocument({ data: data.slice() }).promise;

  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(''));
  }

  const compact = pages.map((text) => text.replace(/\s+/g, ''));

  return { numPages: pdf.numPages, pages: compact, text: compact.join('') };
};

const expectedDisclosureHref = () =>
  process.env.NEXT_PUBLIC_SIGNATURE_DISCLOSURE_URL?.trim() || '/articles/signature-disclosure';

test('[SIGNING_EVIDENCE]: signing requires consent and the record carries the evidence', async ({ page, request }) => {
  const { user: owner, team } = await seedUser();

  // Send through the real send path so the sent, emailed and viewed events are genuine.
  const document = await seedDraftDocument(owner, team.id, ['evidence-signer@test.documenso.com']);
  const [draftRecipient] = await prisma.recipient.findMany({ where: { envelopeId: document.id } });

  await prisma.field.create({
    data: {
      envelopeId: document.id,
      envelopeItemId: document.envelopeItems[0].id,
      recipientId: draftRecipient.id,
      type: FieldType.SIGNATURE,
      page: 1,
      positionX: new Prisma.Decimal(10),
      positionY: new Prisma.Decimal(30),
      width: new Prisma.Decimal(20),
      height: new Prisma.Decimal(8),
      customText: '',
      inserted: false,
    },
  });

  await sendDocument({
    id: { type: 'envelopeId', id: document.id },
    userId: owner.id,
    teamId: team.id,
    sendEmail: true,
    requestMetadata: { auth: 'session', source: 'app', requestMetadata: {} },
  });

  const recipient = await prisma.recipient.findUniqueOrThrow({
    where: { id: draftRecipient.id },
    include: { fields: true },
  });

  await page.goto(`/sign/${recipient.token}`);

  await signSignaturePad(page);

  for (const field of recipient.fields) {
    await page.locator(`#field-${field.id}`).getByRole('button').click();
    await expect(page.locator(`#field-${field.id}`)).toHaveAttribute('data-inserted', 'true');
  }

  await page.getByRole('button', { name: 'Complete' }).click();

  // The disclosure and its link sit in the same dialog as the final Sign button.
  const dialog = page.getByRole('dialog');

  await expect(dialog.getByText('you acknowledge and consent that it will be used to sign the given')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'signature disclosure' })).toHaveAttribute(
    'href',
    expectedDisclosureHref(),
  );

  // Every field is filled, but until the signer presses Sign nothing is recorded as signed.
  const beforeConsent = await prisma.recipient.findUniqueOrThrow({ where: { id: recipient.id } });
  expect(beforeConsent.signingStatus).toBe(SigningStatus.NOT_SIGNED);

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(1000);

  const afterCancel = await prisma.recipient.findUniqueOrThrow({ where: { id: recipient.id } });
  expect(afterCancel.signingStatus).toBe(SigningStatus.NOT_SIGNED);

  await page.getByRole('button', { name: 'Complete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign' }).click();
  await page.waitForURL(`/sign/${recipient.token}/complete`);

  await expect(async () => {
    const envelope = await prisma.envelope.findUniqueOrThrow({ where: { id: document.id } });

    expect(envelope.status).toBe(DocumentStatus.COMPLETED);
  }).toPass({ timeout: 30_000 });

  // The completion audit row records who, when, from where and with what.
  const completedLog = await prisma.documentAuditLog.findFirstOrThrow({
    where: { envelopeId: document.id, type: DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_COMPLETED },
  });

  expect(completedLog.ipAddress).toBe(SIGNER_IP);
  expect(completedLog.userAgent).toBe(SIGNER_USER_AGENT);
  expect(completedLog.createdAt).toBeInstanceOf(Date);
  expect(completedLog.data).toMatchObject({ recipientEmail: recipient.email });

  const completedEnvelope = await prisma.envelope.findUniqueOrThrow({
    where: { id: document.id },
    include: { envelopeItems: { include: { documentData: true } } },
  });

  const signedPdfUrl = getEnvelopeItemPdfUrl({
    type: 'download',
    envelopeItem: completedEnvelope.envelopeItems[0],
    token: recipient.token,
    version: 'signed',
  });

  const signedPdfBytes = new Uint8Array(await (await fetch(signedPdfUrl)).arrayBuffer());

  // Certificate of completion, appended as the last page of the signed PDF.
  const signedPdf = await extractPdfText(signedPdfBytes);
  const certificate = signedPdf.pages[signedPdf.numPages - 1];

  // The certificate's PDF text comes out in glyph runs, so compare without whitespace.
  expect(certificate).toContain('SigningCertificate');
  expect(certificate).toContain(recipient.email);
  expect(certificate).toContain('AuthenticationLevel:Email');
  expect(certificate).toContain(`IPAddress:${SIGNER_IP}`);
  expect(certificate).toMatch(/Device:Linux/);
  expect(certificate).toMatch(/Sent:\d{4}/);
  expect(certificate).toMatch(/Viewed:\d{4}/);
  expect(certificate).toMatch(/Signed:\d{4}/);
  const signatureField = recipient.fields.find((field) => field.type === FieldType.SIGNATURE);
  expect(certificate).toContain(signatureField?.secondaryId.toUpperCase() ?? 'missing-signature-field');

  // Tamper evidence: a PDF signature whose byte range spans the whole file.
  const signedPdfLatin1 = Buffer.from(signedPdfBytes).toString('latin1');
  const byteRanges = [...signedPdfLatin1.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];

  expect(byteRanges.length).toBeGreaterThan(0);

  const [, start, firstLength, secondStart, secondLength] = byteRanges[byteRanges.length - 1].map(Number);

  expect(start).toBe(0);
  expect(secondStart + secondLength).toBe(signedPdfBytes.length);
  expect(secondStart).toBeGreaterThan(firstLength);
  expect(signedPdfLatin1).toMatch(/\/SubFilter\s*\/(ETSI\.CAdES\.detached|adbe\.pkcs7\.detached)/);

  // Audit log PDF, as an administrator or the filing integration downloads it.
  const { token } = await createApiToken({
    userId: owner.id,
    teamId: team.id,
    tokenName: 'evidence',
    expiresIn: null,
  });

  const auditLogResponse = await request.get(
    `${NEXT_PUBLIC_WEBAPP_URL()}/api/v2/envelope/${document.id}/audit-log/download`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  expect(auditLogResponse.status()).toBe(200);

  const auditLog = await extractPdfText(new Uint8Array(await auditLogResponse.body()));

  expect(auditLog.text).toContain('AuditLog');
  expect(auditLog.text).toContain(recipient.email);
  expect(auditLog.text.toUpperCase()).toContain('IPADDRESS');
  expect(auditLog.text).toContain(SIGNER_IP);
  expect(auditLog.text.toUpperCase()).toContain('USERAGENT');
});
