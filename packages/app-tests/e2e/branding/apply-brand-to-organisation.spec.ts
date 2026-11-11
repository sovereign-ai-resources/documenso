import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyBrandToOrganisation } from '@documenso/lib/server-only/branding/apply-brand-to-organisation';
import { prisma } from '@documenso/prisma';
import { seedUser } from '@documenso/prisma/seed/users';
import { expect, test } from '@playwright/test';

// These tests call the startup step in this process against the test
// database, so the environment is set here rather than on the web server.

test.describe.configure({ mode: 'serial' });

const PACK_DETAILS = 'Example Co, Inc.\n1 Example Street';
const PACK_URL = 'https://brand.example';

const withEnv = async <T>(values: Record<string, string | undefined>, fn: () => Promise<T>) => {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const previousCwd = process.cwd();

  // The step reads the pack logo from public/static/logo.png under the working directory.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-org-'));
  fs.mkdirSync(path.join(dir, 'public/static'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../../../assets/logo.png'), path.join(dir, 'public/static/logo.png'));

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  process.chdir(dir);

  try {
    return await fn();
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(dir, { recursive: true, force: true });

    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

const run = async ({ organisationId, reapply = false }: { organisationId?: string; reapply?: boolean }) =>
  await withEnv(
    {
      NEXT_PUBLIC_BRAND: JSON.stringify({
        name: 'Example Co',
        legalName: 'Example Co, Inc.',
        companyDetails: PACK_DETAILS,
      }),
      NEXT_PUBLIC_BRAND_WEBSITE_URL: PACK_URL,
      NEXT_PRIVATE_SINGLE_ORGANISATION_ID: organisationId,
      NEXT_PRIVATE_BRAND_REAPPLY: reapply ? 'true' : undefined,
    },
    async () => applyBrandToOrganisation(),
  );

const getSettings = async (settingsId: string) =>
  await prisma.organisationGlobalSettings.findUniqueOrThrow({ where: { id: settingsId } });

const seedOrganisation = async () => {
  const { organisation } = await seedUser();

  return { organisationId: organisation.id, settingsId: organisation.organisationGlobalSettingsId };
};

test('[BRAND_ORGANISATION]: an organisation at defaults gets the pack logo, website and company details', async () => {
  const { organisationId, settingsId } = await seedOrganisation();

  await run({ organisationId });

  const settings = await getSettings(settingsId);

  expect(settings.brandingEnabled).toBe(true);
  expect(settings.brandingUrl).toBe(PACK_URL);
  expect(settings.brandingCompanyDetails).toBe(PACK_DETAILS);
  expect(JSON.parse(settings.brandingLogo)).toMatchObject({ type: 'BYTES_64' });
});

test('[BRAND_ORGANISATION]: running twice changes nothing the second time', async () => {
  const { organisationId, settingsId } = await seedOrganisation();

  await run({ organisationId });
  const first = await getSettings(settingsId);

  await run({ organisationId });
  const second = await getSettings(settingsId);

  expect(second).toEqual(first);
});

test('[BRAND_ORGANISATION]: company details an admin changed are kept', async () => {
  const { organisationId, settingsId } = await seedOrganisation();

  await run({ organisationId });
  await prisma.organisationGlobalSettings.update({
    where: { id: settingsId },
    data: { brandingCompanyDetails: 'Edited by an admin' },
  });

  await run({ organisationId });

  expect((await getSettings(settingsId)).brandingCompanyDetails).toBe('Edited by an admin');
});

test('[BRAND_ORGANISATION]: branding an admin turned off stays off', async () => {
  const { organisationId, settingsId } = await seedOrganisation();

  await run({ organisationId });
  await prisma.organisationGlobalSettings.update({ where: { id: settingsId }, data: { brandingEnabled: false } });

  await run({ organisationId });

  expect((await getSettings(settingsId)).brandingEnabled).toBe(false);
});

test('[BRAND_ORGANISATION]: the reapply flag replaces an admin edit with the pack values', async () => {
  const { organisationId, settingsId } = await seedOrganisation();

  await run({ organisationId });
  await prisma.organisationGlobalSettings.update({
    where: { id: settingsId },
    data: { brandingCompanyDetails: 'Edited by an admin' },
  });

  await run({ organisationId, reapply: true });

  expect((await getSettings(settingsId)).brandingCompanyDetails).toBe(PACK_DETAILS);
});

test('[BRAND_ORGANISATION]: no organisation id means no writes', async () => {
  const { settingsId } = await seedOrganisation();

  await run({});

  const settings = await getSettings(settingsId);

  expect(settings.brandingEnabled).toBe(false);
  expect(settings.brandingLogo).toBe('');
});

test('[BRAND_ORGANISATION]: an organisation id that does not exist neither writes nor throws', async () => {
  const { settingsId } = await seedOrganisation();

  await expect(run({ organisationId: 'org_does_not_exist' })).resolves.toBeUndefined();

  expect((await getSettings(settingsId)).brandingEnabled).toBe(false);
});
