import { setRecipientAccessCode } from '@documenso/lib/server-only/access-code/set-recipient-access-code';
import { sendDocument } from '@documenso/lib/server-only/document/send-document';
import { createApiToken } from '@documenso/lib/server-only/public-api/create-api-token';
import { updateEnvelopeRecipients } from '@documenso/lib/server-only/recipient/update-envelope-recipients';
import { createDocumentFromTemplate } from '@documenso/lib/server-only/template/create-document-from-template';
import type { ApiRequestMetadata } from '@documenso/lib/universal/extract-request-metadata';
import { prisma } from '@documenso/prisma';
import { seedDraftDocument, seedPendingDocument } from '@documenso/prisma/seed/documents';
import { seedTemplate } from '@documenso/prisma/seed/templates';
import { seedUser } from '@documenso/prisma/seed/users';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

import { apiSignin } from '../fixtures/authentication';

const ACCESS_CODE_ENABLED = process.env.NEXT_PUBLIC_FEATURE_ACCESS_CODE === 'true';
const WEBAPP_URL = process.env.NEXT_PUBLIC_WEBAPP_URL || 'http://localhost:3000';
const PDF_PAGE_SELECTOR = 'img[data-page-number]';
const CODE = 'k3x9p2';

const requestMetadata = (user: { id: number; email: string; name: string | null }): ApiRequestMetadata => ({
  requestMetadata: {},
  source: 'app',
  auth: 'session',
  auditUser: { id: user.id, email: user.email, name: user.name },
});

const seedAccessCodeDocument = async ({ internalVersion = 2 }: { internalVersion?: 1 | 2 } = {}) => {
  const { user, team } = await seedUser();

  const envelope = await seedPendingDocument(
    user,
    team.id,
    ['access-code-signer@documenso.com', 'plain-signer@documenso.com'],
    { internalVersion },
  );

  const recipients = await prisma.recipient.findMany({ where: { envelopeId: envelope.id }, orderBy: { id: 'asc' } });
  const [protectedRecipient, plainRecipient] = recipients;

  await setRecipientAccessCode({
    userId: user.id,
    teamId: team.id,
    envelopeId: envelope.id,
    recipientId: protectedRecipient.id,
    enabled: true,
    code: CODE,
    requestMetadata: requestMetadata(user),
  });

  const envelopeItem = await prisma.envelopeItem.findFirstOrThrow({ where: { envelopeId: envelope.id } });

  return { user, team, envelope, envelopeItem, protectedRecipient, plainRecipient };
};

const submitCode = async (page: Page, code: string) => {
  await page.getByLabel('Access code').fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
};

const fetchPdf = async (request: APIRequestContext, token: string, envelopeItemId: string) =>
  request.get(`/api/files/token/${token}/envelopeItem/${envelopeItemId}`);

test.describe('[DOCUMENT_AUTH]: access code', () => {
  test.skip(!ACCESS_CODE_ENABLED, 'Requires NEXT_PUBLIC_FEATURE_ACCESS_CODE=true on the server under test');

  for (const internalVersion of [1, 2] as const) {
    test(`v${internalVersion}: the correct code reveals the document and a wrong code is refused`, async ({ page }) => {
      const { protectedRecipient, plainRecipient } = await seedAccessCodeDocument({ internalVersion });

      await page.goto(`/sign/${protectedRecipient.token}`);
      await expect(page.getByRole('heading', { name: 'Access code required' })).toBeVisible();
      await expect(page.locator(PDF_PAGE_SELECTOR)).toHaveCount(0);

      await submitCode(page, 'wrong-code-1');
      await expect(page.getByTestId('access-code-error')).toContainText('Incorrect access code');

      await submitCode(page, CODE);
      await expect(page.getByRole('heading', { name: 'Access code required' })).not.toBeVisible();

      if (internalVersion === 1) {
        await expect(page.getByRole('heading', { name: 'Sign Document' })).toBeVisible();
      } else {
        await expect(page.getByRole('button', { name: 'Complete' })).toBeVisible();
      }

      await page.goto(`/sign/${plainRecipient.token}`);
      await expect(page.getByRole('heading', { name: 'Access code required' })).not.toBeVisible();
    });
  }

  test('the PDF needs the verification cookie, and a second browser is prompted again', async ({
    page,
    browser,
    request,
  }) => {
    const { protectedRecipient, plainRecipient, envelope, envelopeItem } = await seedAccessCodeDocument({
      internalVersion: 1,
    });

    const pdfByTokenPath = `/api/files/token/${protectedRecipient.token}/envelope/${envelope.id}/envelopeItem/${envelopeItem.id}/dataId/${envelopeItem.documentDataId}/current/item.pdf`;

    expect((await fetchPdf(request, protectedRecipient.token, envelopeItem.id)).status()).toBe(401);
    expect((await request.get(pdfByTokenPath)).status()).toBe(401);

    expect((await fetchPdf(request, plainRecipient.token, envelopeItem.id)).status()).toBe(200);

    await page.goto(`/sign/${protectedRecipient.token}`);
    await submitCode(page, CODE);
    await expect(page.getByRole('heading', { name: 'Sign Document' })).toBeVisible();

    expect((await fetchPdf(page.request, protectedRecipient.token, envelopeItem.id)).status()).toBe(200);
    expect((await page.request.get(pdfByTokenPath)).status()).toBe(200);

    const cookies = await page.context().cookies();
    const accessCodeCookie = cookies.find((cookie) => cookie.name.includes('access_code_'));

    expect(accessCodeCookie?.httpOnly).toBe(true);
    expect(await page.evaluate(() => document.cookie)).not.toContain('access_code_');

    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();

    await otherPage.goto(`${WEBAPP_URL}/sign/${protectedRecipient.token}`);
    await expect(otherPage.getByRole('heading', { name: 'Access code required' })).toBeVisible();
    expect((await fetchPdf(otherPage.request, protectedRecipient.token, envelopeItem.id)).status()).toBe(401);

    await otherContext.close();
  });

  test('the sixth attempt is locked, the sender is notified, and only a new code unlocks', async ({ page }) => {
    const { user, team, envelope, protectedRecipient } = await seedAccessCodeDocument({ internalVersion: 1 });

    await page.goto(`/sign/${protectedRecipient.token}`);

    for (let attempt = 1; attempt <= 4; attempt++) {
      await submitCode(page, `wrong-code-${attempt}`);
      await expect(page.getByTestId('access-code-error')).toContainText(`${5 - attempt} attempts remaining`);
    }

    await submitCode(page, 'wrong-code-5');
    await expect(page.getByTestId('access-code-locked')).toBeVisible();

    await page.goto(`/sign/${protectedRecipient.token}`);
    await expect(page.getByTestId('access-code-locked')).toBeVisible();

    const verifyResponse = await page.request.post('/api/trpc/accessCode.verify?batch=1', {
      data: { 0: { json: { token: protectedRecipient.token, code: CODE } } },
      headers: { 'content-type': 'application/json', origin: new URL(WEBAPP_URL).origin },
    });

    expect(JSON.stringify(await verifyResponse.json())).toContain('"status":"LOCKED"');

    const lockedRecipient = await prisma.recipient.findUniqueOrThrow({ where: { id: protectedRecipient.id } });

    expect(lockedRecipient.authOptions).toMatchObject({ accessCode: { locked: true, failedAttempts: 5 } });

    const auditLogs = await prisma.documentAuditLog.findMany({
      where: { envelopeId: envelope.id, type: 'DOCUMENT_ACCESS_AUTH_ACCESS_CODE' },
    });
    const outcomes = auditLogs.map((log) => (log.data as { outcome: string }).outcome);

    expect(outcomes.filter((outcome) => outcome === 'FAILED')).toHaveLength(5);
    expect(outcomes.filter((outcome) => outcome === 'LOCKED')).toHaveLength(1);

    const inbucketUrl = process.env.E2E_INBUCKET_URL;

    if (inbucketUrl) {
      await expect
        .poll(async () => {
          const response = await fetch(`${inbucketUrl}/api/v1/mailbox/${encodeURIComponent(user.email)}`);
          const messages = (await response.json()) as { subject: string }[];

          return messages.some((message) => message.subject.startsWith('Access code locked'));
        })
        .toBe(true);
    }

    await setRecipientAccessCode({
      userId: user.id,
      teamId: team.id,
      envelopeId: envelope.id,
      recipientId: protectedRecipient.id,
      enabled: true,
      code: 'n7q2w8',
      requestMetadata: requestMetadata(user),
    });

    await page.goto(`/sign/${protectedRecipient.token}`);
    await submitCode(page, 'n7q2w8');
    await expect(page.getByRole('heading', { name: 'Sign Document' })).toBeVisible();
  });

  test('the sender sets the code per recipient, and weak codes are refused', async ({ page }) => {
    const { user, team } = await seedUser();

    const envelope = await seedPendingDocument(user, team.id, ['ui-signer@documenso.com'], { internalVersion: 2 });
    const recipient = await prisma.recipient.findFirstOrThrow({ where: { envelopeId: envelope.id } });

    await apiSignin({ page, email: user.email, redirectPath: `/t/${team.url}/documents/${envelope.id}` });

    await page.getByTestId(`access-code-control-${recipient.id}`).click();
    await page.getByLabel('Require access code').click();

    for (const weakCode of ['12345', '111111', '123456']) {
      await page.locator('#access-code-value').fill(weakCode);
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByTestId('access-code-control-error')).toBeVisible();
    }

    const unchanged = await prisma.recipient.findUniqueOrThrow({ where: { id: recipient.id } });

    expect(JSON.stringify(unchanged.authOptions ?? {})).not.toContain('ACCESS_CODE');

    await page.locator('#access-code-value').fill(CODE);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();

    const updated = await prisma.recipient.findUniqueOrThrow({ where: { id: recipient.id } });

    expect(updated.authOptions).toMatchObject({ accessAuth: ['ACCESS_CODE'], accessCode: { failedAttempts: 0 } });
    expect(JSON.stringify(updated.authOptions)).not.toContain(CODE);
  });

  test('the stored hash survives a recipient update and never appears in an API GET', async () => {
    const { user, team } = await seedUser();

    const envelope = await seedDraftDocument(user, team.id, ['draft-signer@documenso.com'], { internalVersion: 2 });
    const protectedRecipient = await prisma.recipient.findFirstOrThrow({ where: { envelopeId: envelope.id } });

    await setRecipientAccessCode({
      userId: user.id,
      teamId: team.id,
      envelopeId: envelope.id,
      recipientId: protectedRecipient.id,
      enabled: true,
      code: CODE,
      requestMetadata: requestMetadata(user),
    });

    const before = await prisma.recipient.findUniqueOrThrow({ where: { id: protectedRecipient.id } });
    const storedHash = (before.authOptions as { accessCode: { hash: string } }).accessCode.hash;

    await updateEnvelopeRecipients({
      userId: user.id,
      teamId: team.id,
      id: { type: 'envelopeId', id: envelope.id },
      recipients: [{ id: protectedRecipient.id, name: 'Renamed Signer' }],
      requestMetadata: requestMetadata(user),
    });

    const after = await prisma.recipient.findUniqueOrThrow({ where: { id: protectedRecipient.id } });

    expect(after.name).toBe('Renamed Signer');
    expect((after.authOptions as { accessCode: { hash: string } }).accessCode.hash).toBe(storedHash);

    const { token } = await createApiToken({
      userId: user.id,
      teamId: team.id,
      tokenName: `access-code-${Date.now()}`,
      expiresIn: null,
    });

    for (const path of [`/envelope/${envelope.id}`, `/envelope/recipient/${protectedRecipient.id}`]) {
      const response = await fetch(`${WEBAPP_URL}/api/v2${path}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await response.text();

      expect(response.ok, `${path} ${body}`).toBe(true);
      expect(body).toContain('ACCESS_CODE');
      expect(body).not.toContain(storedHash);
      expect(body).not.toContain('accessCode');
    }
  });

  test('templates carry the setting but never a stored code', async () => {
    const { user, team } = await seedUser();

    const template = await seedTemplate({ title: 'Access code template', userId: user.id, teamId: team.id });
    const [templateRecipient] = template.recipients;

    await expect(
      setRecipientAccessCode({
        userId: user.id,
        teamId: team.id,
        envelopeId: template.id,
        recipientId: templateRecipient.id,
        enabled: true,
        code: CODE,
        requestMetadata: requestMetadata(user),
      }),
    ).rejects.toThrow();

    await setRecipientAccessCode({
      userId: user.id,
      teamId: team.id,
      envelopeId: template.id,
      recipientId: templateRecipient.id,
      enabled: true,
      requestMetadata: requestMetadata(user),
    });

    const storedTemplateRecipient = await prisma.recipient.findUniqueOrThrow({ where: { id: templateRecipient.id } });

    expect(storedTemplateRecipient.authOptions).toEqual({ accessAuth: ['ACCESS_CODE'], actionAuth: [] });

    const document = await createDocumentFromTemplate({
      id: { type: 'envelopeId', id: template.id },
      userId: user.id,
      teamId: team.id,
      recipients: [{ id: templateRecipient.id, email: 'from-template@documenso.com', name: 'From Template' }],
      requestMetadata: requestMetadata(user),
    });

    const documentRecipient = await prisma.recipient.findFirstOrThrow({ where: { envelopeId: document.id } });

    expect(documentRecipient.authOptions).toMatchObject({ accessAuth: ['ACCESS_CODE'] });
    expect(documentRecipient.authOptions).not.toHaveProperty('accessCode');

    await expect(
      sendDocument({
        id: { type: 'envelopeId', id: document.id },
        userId: user.id,
        teamId: team.id,
        requestMetadata: requestMetadata(user),
      }),
    ).rejects.toThrow(/requires an access code/);
  });

  test('the audit log records the method and outcome but never the code, and cfr21 stays off', async ({ page }) => {
    const { team, envelope, protectedRecipient } = await seedAccessCodeDocument({ internalVersion: 1 });

    await page.goto(`/sign/${protectedRecipient.token}`);
    await submitCode(page, 'wrong-code-1');
    await expect(page.getByTestId('access-code-error')).toBeVisible();
    await submitCode(page, CODE);
    await expect(page.getByRole('heading', { name: 'Sign Document' })).toBeVisible();

    const auditLogs = await prisma.documentAuditLog.findMany({ where: { envelopeId: envelope.id } });
    const serialized = JSON.stringify(auditLogs);
    const accessCodeOutcomes = auditLogs
      .filter((log) => log.type === 'DOCUMENT_ACCESS_AUTH_ACCESS_CODE')
      .map((log) => {
        const data = log.data as { method: string; outcome: string };

        return `${data.method}:${data.outcome}`;
      });

    expect(accessCodeOutcomes).toEqual(
      expect.arrayContaining(['ACCESS_CODE:SET', 'ACCESS_CODE:FAILED', 'ACCESS_CODE:VALIDATED']),
    );

    const viewed = auditLogs.find((log) => log.type === 'DOCUMENT_OPENED' || log.type === 'DOCUMENT_VIEWED');

    expect(viewed?.data).toMatchObject({ accessAuth: ['ACCESS_CODE'] });
    expect(serialized).not.toContain(CODE);
    expect(serialized).not.toContain('wrong-code-1');

    const stored = await prisma.recipient.findUniqueOrThrow({ where: { id: protectedRecipient.id } });
    const { hash, salt } = (stored.authOptions as { accessCode: { hash: string; salt: string } }).accessCode;

    expect(serialized).not.toContain(hash);
    expect(serialized).not.toContain(salt);

    const organisation = await prisma.organisation.findFirstOrThrow({
      where: { teams: { some: { id: team.id } } },
      include: { organisationClaim: true },
    });

    expect((organisation.organisationClaim.flags as { cfr21?: boolean }).cfr21 ?? false).toBe(false);
  });
});

test.describe('[DOCUMENT_AUTH]: access code feature flag off', () => {
  test.skip(ACCESS_CODE_ENABLED, 'Requires NEXT_PUBLIC_FEATURE_ACCESS_CODE unset on the server under test');

  test('the sender option is hidden and signing is unchanged', async ({ page }) => {
    const { user, team } = await seedUser();

    const envelope = await seedPendingDocument(user, team.id, ['flag-off-signer@documenso.com'], {
      internalVersion: 2,
    });
    const recipient = await prisma.recipient.findFirstOrThrow({ where: { envelopeId: envelope.id } });

    await apiSignin({ page, email: user.email, redirectPath: `/t/${team.url}/documents/${envelope.id}` });
    await expect(page.getByRole('heading', { name: 'Recipients' })).toBeVisible();
    await expect(page.getByTestId(`access-code-control-${recipient.id}`)).toHaveCount(0);

    await expect(
      setRecipientAccessCode({
        userId: user.id,
        teamId: team.id,
        envelopeId: envelope.id,
        recipientId: recipient.id,
        enabled: true,
        code: CODE,
        requestMetadata: requestMetadata(user),
      }),
    ).rejects.toThrow(/not enabled/);

    await page.goto(`/sign/${recipient.token}`);
    await expect(page.getByRole('button', { name: 'Complete' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Access code required' })).not.toBeVisible();
  });
});
