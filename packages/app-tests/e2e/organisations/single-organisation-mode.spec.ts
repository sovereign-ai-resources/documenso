import { sendDocument } from '@documenso/lib/server-only/document/send-document';
import { createEnvelope } from '@documenso/lib/server-only/envelope/create-envelope';
import { duplicateEnvelope } from '@documenso/lib/server-only/envelope/duplicate-envelope';
import { createTeam } from '@documenso/lib/server-only/team/create-team';
import { onCreateUserHook } from '@documenso/lib/server-only/user/create-user';
import {
  assertCanCreateOrganisationOrTeam,
  assertSingleOrganisationConfigured,
  joinSingleOrganisation,
} from '@documenso/lib/server-only/user/single-organisation';
import { buildTeamWhereQuery } from '@documenso/lib/utils/teams';
import { prisma } from '@documenso/prisma';
import { EnvelopeType, FieldType, Prisma, WebhookTriggerEvents } from '@documenso/prisma/client';
import { seedDraftDocument } from '@documenso/prisma/seed/documents';
import { seedTestEmail, seedUser } from '@documenso/prisma/seed/users';
import { expect, test } from '@playwright/test';

// Single-organisation mode (NEXT_PRIVATE_SINGLE_ORGANISATION_ID). These tests
// call the server functions in this process, so the flag is set here rather
// than on the web server. The OIDC callback itself needs a live identity
// provider; it reaches these functions through onCreateUserHook (sign-up) and
// onAuthorize (every sign-in).

const FLAG = 'NEXT_PRIVATE_SINGLE_ORGANISATION_ID';

const requestMetadata = {
  auth: null,
  requestMetadata: {},
  source: 'app' as const,
};

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

const seedConfiguredOrganisation = async () => {
  const { user: owner, organisation, team } = await seedUser({ isAdmin: true });

  return { owner, organisation, team };
};

const createBareUser = async () =>
  await prisma.user.create({
    data: { email: seedTestEmail(), name: 'New Staff Member', emailVerified: new Date() },
  });

const canAccessTeam = async (userId: number, teamId: number) =>
  Boolean(await prisma.team.findFirst({ where: buildTeamWhereQuery({ teamId, userId }) }));

const addSignatureFields = async (envelopeId: string) => {
  const envelope = await prisma.envelope.findUniqueOrThrow({
    where: { id: envelopeId },
    include: { recipients: true, envelopeItems: true },
  });

  for (const recipient of envelope.recipients) {
    await prisma.field.create({
      data: {
        envelopeId,
        envelopeItemId: envelope.envelopeItems[0].id,
        recipientId: recipient.id,
        type: FieldType.SIGNATURE,
        page: 1,
        positionX: new Prisma.Decimal(10),
        positionY: new Prisma.Decimal(10),
        width: new Prisma.Decimal(10),
        height: new Prisma.Decimal(5),
        customText: '',
        inserted: false,
      },
    });
  }
};

test('[SINGLE_ORGANISATION]: a new user gets no personal organisation and joins the configured team', async () => {
  const { organisation, team } = await seedConfiguredOrganisation();

  const user = await createBareUser();

  await withFlag(organisation.id, async () => {
    await onCreateUserHook(user);
    await joinSingleOrganisation({ userId: user.id });
  });

  const memberships = await prisma.organisationMember.findMany({ where: { userId: user.id } });

  expect(memberships.map((member) => member.organisationId)).toEqual([organisation.id]);
  expect(await prisma.organisation.count({ where: { ownerUserId: user.id } })).toBe(0);
  expect(await canAccessTeam(user.id, team.id)).toBe(true);
});

test('[SINGLE_ORGANISATION]: signing in again does not duplicate the membership', async () => {
  const { organisation } = await seedConfiguredOrganisation();

  const user = await createBareUser();

  await withFlag(organisation.id, async () => {
    await joinSingleOrganisation({ userId: user.id });
    await joinSingleOrganisation({ userId: user.id });
    await Promise.all([joinSingleOrganisation({ userId: user.id }), joinSingleOrganisation({ userId: user.id })]);
  });

  expect(await prisma.organisationMember.count({ where: { userId: user.id, organisationId: organisation.id } })).toBe(
    1,
  );
});

test('[SINGLE_ORGANISATION]: a user created before the flag is joined on their next sign-in', async () => {
  const { organisation, team } = await seedConfiguredOrganisation();
  const { user: existingUser } = await seedUser();

  expect(await canAccessTeam(existingUser.id, team.id)).toBe(false);

  await withFlag(organisation.id, async () => joinSingleOrganisation({ userId: existingUser.id }));

  expect(await canAccessTeam(existingUser.id, team.id)).toBe(true);
});

test('[SINGLE_ORGANISATION]: a leftover personal organisation cannot create or send documents', async () => {
  const { organisation } = await seedConfiguredOrganisation();
  const { user, team: personalTeam } = await seedUser();

  const draft = await seedDraftDocument(user, personalTeam.id, ['recipient@test.documenso.com']);
  await addSignatureFields(draft.id);

  await withFlag(organisation.id, async () => {
    await joinSingleOrganisation({ userId: user.id });

    await expect(
      createEnvelope({
        userId: user.id,
        teamId: personalTeam.id,
        internalVersion: 2,
        data: { type: EnvelopeType.DOCUMENT, title: 'Should not exist', envelopeItems: [] },
        requestMetadata,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      createEnvelope({
        userId: user.id,
        teamId: personalTeam.id,
        internalVersion: 2,
        data: { type: EnvelopeType.TEMPLATE, title: 'Should not exist', envelopeItems: [] },
        requestMetadata,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      duplicateEnvelope({ id: { type: 'envelopeId', id: draft.id }, userId: user.id, teamId: personalTeam.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      sendDocument({
        id: { type: 'envelopeId', id: draft.id },
        userId: user.id,
        teamId: personalTeam.id,
        sendEmail: false,
        requestMetadata,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  const after = await prisma.envelope.findUniqueOrThrow({ where: { id: draft.id } });
  expect(after.status).toBe('DRAFT');
});

test('[SINGLE_ORGANISATION]: a document sent by a joined user fires the team webhook', async () => {
  const { owner, organisation, team } = await seedConfiguredOrganisation();

  const webhook = await prisma.webhook.create({
    data: {
      webhookUrl: 'https://webhook.example.invalid/',
      eventTriggers: [WebhookTriggerEvents.DOCUMENT_SENT],
      enabled: true,
      userId: owner.id,
      teamId: team.id,
    },
  });

  const user = await createBareUser();

  await withFlag(organisation.id, async () => {
    await onCreateUserHook(user);
    await joinSingleOrganisation({ userId: user.id });

    const draft = await seedDraftDocument(user, team.id, ['counterparty@test.documenso.com']);
    await addSignatureFields(draft.id);

    await sendDocument({
      id: { type: 'envelopeId', id: draft.id },
      userId: user.id,
      teamId: team.id,
      sendEmail: false,
      requestMetadata,
    });
  });

  const webhookJobs = await prisma.backgroundJob.findMany({
    where: { jobId: 'internal.execute-webhook', payload: { path: ['webhookId'], equals: webhook.id } },
  });

  expect(webhookJobs).toHaveLength(1);
  expect(webhookJobs[0].payload).toMatchObject({ event: WebhookTriggerEvents.DOCUMENT_SENT });
});

test('[SINGLE_ORGANISATION]: only instance administrators can create organisations or teams', async () => {
  const { owner: admin, organisation } = await seedConfiguredOrganisation();
  const { user: nonAdmin } = await seedUser();

  await withFlag(organisation.id, async () => {
    await expect(assertCanCreateOrganisationOrTeam({ userId: nonAdmin.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    await expect(assertCanCreateOrganisationOrTeam({ userId: admin.id })).resolves.toBeUndefined();

    // The administrator can still manage the configured organisation.
    const teamUrl = `team-${Date.now()}`;

    await createTeam({
      userId: admin.id,
      teamName: 'Second Team',
      teamUrl,
      organisationId: organisation.id,
      inheritMembers: true,
    });

    expect(await prisma.team.count({ where: { organisationId: organisation.id, url: teamUrl } })).toBe(1);
  });
});

test('[SINGLE_ORGANISATION]: a configured id that does not exist fails loudly', async () => {
  await withFlag('org_does_not_exist', async () => {
    await expect(assertSingleOrganisationConfigured()).rejects.toThrow(/NEXT_PRIVATE_SINGLE_ORGANISATION_ID/);

    const user = await createBareUser();

    await expect(joinSingleOrganisation({ userId: user.id })).rejects.toThrow(/NEXT_PRIVATE_SINGLE_ORGANISATION_ID/);
  });
});

test('[SINGLE_ORGANISATION]: with the flag unset a new user gets a personal organisation as upstream', async () => {
  const user = await createBareUser();

  await withFlag(undefined, async () => {
    await onCreateUserHook(user);
    await joinSingleOrganisation({ userId: user.id });
  });

  expect(await prisma.organisation.count({ where: { ownerUserId: user.id } })).toBe(1);
  expect(await prisma.organisationMember.count({ where: { userId: user.id } })).toBe(1);
});
