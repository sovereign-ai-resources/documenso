import { prisma } from '@documenso/prisma';
import { seedCompletedDocument, seedPendingDocumentWithFullFields } from '@documenso/prisma/seed/documents';
import { seedUser } from '@documenso/prisma/seed/users';
import { expect, type Page, test } from '@playwright/test';
import { FieldType } from '@prisma/client';

// Runs only against a server started with a brand pack and a source offer, like the paired skip in the access-code spec.
const BRANDED = process.env.E2E_BRANDED === 'true';
const PDF_PAGE_SELECTOR = 'img[data-page-number]';

test.skip(!BRANDED, 'Requires a branded build (E2E_BRANDED=true)');

const expectSourceLink = async (page: Page) => {
  const link = page.locator('a[href$="/source"]');

  await expect(link).toHaveCount(1);
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(page.getByText('Based on Documenso (AGPL-3.0)')).toBeVisible();
};

const seedSigner = async (internalVersion: 1 | 2) => {
  const { user, team } = await seedUser();

  const { recipients } = await seedPendingDocumentWithFullFields({
    owner: user,
    teamId: team.id,
    recipients: [`source-offer-v${internalVersion}@test.documenso.com`],
    fields: [FieldType.SIGNATURE],
    updateDocumentOptions: { internalVersion },
  });

  return recipients[0];
};

test('[SOURCE_OFFER]: the sign-in page links to the source', async ({ page }) => {
  await page.goto('/signin');

  await expectSourceLink(page);
});

test('[SOURCE_OFFER]: a V2 signing page links to the source', async ({ page }) => {
  const recipient = await seedSigner(2);

  await page.goto(`/sign/${recipient.token}`);
  await expect(page.locator(PDF_PAGE_SELECTOR).first()).toBeVisible({ timeout: 30_000 });

  await expectSourceLink(page);
});

test('[SOURCE_OFFER]: a V1 signing page links to the source', async ({ page }) => {
  const recipient = await seedSigner(1);

  await page.goto(`/sign/${recipient.token}`);
  await expect(page.locator(PDF_PAGE_SELECTOR).first()).toBeVisible({ timeout: 30_000 });

  await expectSourceLink(page);
});

test('[SOURCE_OFFER]: the signing-complete page links to the source', async ({ page }) => {
  const { user, team } = await seedUser();
  const envelope = await seedCompletedDocument(user, team.id, ['source-offer-complete@test.documenso.com']);
  const recipient = await prisma.recipient.findFirstOrThrow({ where: { envelopeId: envelope.id } });

  await page.goto(`/sign/${recipient.token}/complete`);

  await expectSourceLink(page);
});

test('[SOURCE_OFFER]: an embed page links to the source', async ({ page }) => {
  const recipient = await seedSigner(2);

  await page.goto(`/embed/sign/${recipient.token}`);
  await expect(page.locator(PDF_PAGE_SELECTOR).first()).toBeVisible({ timeout: 30_000 });

  await expectSourceLink(page);
});

test('[SOURCE_OFFER]: /source redirects to the tree of the deployed commit', async ({ request }) => {
  const response = await request.get('/source', { maxRedirects: 0 });

  expect(response.status()).toBe(302);
  expect(response.headers().location).toContain('/tree/');
});

test('[SOURCE_OFFER]: at a phone width the footer does not overlap the signing buttons', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });

  const recipient = await seedSigner(2);

  await page.goto(`/sign/${recipient.token}`);
  await expect(page.locator(PDF_PAGE_SELECTOR).first()).toBeVisible({ timeout: 30_000 });

  const footer = await page.locator('a[href$="/source"]').locator('xpath=..').boundingBox();

  expect(footer).not.toBeNull();

  const buttons = page.getByRole('button');
  const count = await buttons.count();

  for (let index = 0; index < count; index += 1) {
    const box = await buttons.nth(index).boundingBox();

    if (!box || !footer) {
      continue;
    }

    const overlaps =
      box.x < footer.x + footer.width &&
      box.x + box.width > footer.x &&
      box.y < footer.y + footer.height &&
      box.y + box.height > footer.y;

    expect(overlaps, `button ${index} overlaps the source footer`).toBe(false);
  }
});
