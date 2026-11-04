import { OrganisationGroupType, OrganisationMemberRole, Role } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  organisationFindUnique: vi.fn(),
  organisationMemberFindFirst: vi.fn(),
  teamFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  addUserToOrganisation: vi.fn(),
}));

vi.mock('@documenso/prisma', () => ({
  prisma: {
    organisation: { findUnique: mocks.organisationFindUnique },
    organisationMember: { findFirst: mocks.organisationMemberFindFirst },
    team: { findUnique: mocks.teamFindUnique },
    user: { findUnique: mocks.userFindUnique },
  },
}));

vi.mock('../organisation/accept-organisation-invitation', () => ({
  addUserToOrganisation: mocks.addUserToOrganisation,
}));

import {
  assertCanCreateOrganisationOrTeam,
  assertSingleOrganisationConfigured,
  assertTeamInSingleOrganisation,
  isSingleOrganisationMode,
  joinSingleOrganisation,
} from './single-organisation';

const ORG_ID = 'org_configured';

const memberGroup = {
  id: 'group_member',
  type: OrganisationGroupType.INTERNAL_ORGANISATION,
  organisationRole: OrganisationMemberRole.MEMBER,
};

const adminGroup = {
  id: 'group_admin',
  type: OrganisationGroupType.INTERNAL_ORGANISATION,
  organisationRole: OrganisationMemberRole.ADMIN,
};

const configuredOrganisation = (overrides: Record<string, unknown> = {}) => ({
  id: ORG_ID,
  groups: [adminGroup, memberGroup],
  teams: [{ id: 7, teamGroups: [{ organisationGroupId: 'group_admin' }, { organisationGroupId: 'group_member' }] }],
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PRIVATE_SINGLE_ORGANISATION_ID', ORG_ID);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isSingleOrganisationMode', () => {
  it('is off when the variable is unset or blank', () => {
    vi.stubEnv('NEXT_PRIVATE_SINGLE_ORGANISATION_ID', '');
    expect(isSingleOrganisationMode()).toBe(false);

    vi.stubEnv('NEXT_PRIVATE_SINGLE_ORGANISATION_ID', '   ');
    expect(isSingleOrganisationMode()).toBe(false);
  });

  it('is on when the variable holds an organisation id', () => {
    expect(isSingleOrganisationMode()).toBe(true);
  });
});

describe('assertSingleOrganisationConfigured', () => {
  it('does nothing when the mode is off', async () => {
    vi.stubEnv('NEXT_PRIVATE_SINGLE_ORGANISATION_ID', '');

    await expect(assertSingleOrganisationConfigured()).resolves.toBeUndefined();
    expect(mocks.organisationFindUnique).not.toHaveBeenCalled();
  });

  it('fails loudly when the configured organisation does not exist', async () => {
    mocks.organisationFindUnique.mockResolvedValue(null);

    await expect(assertSingleOrganisationConfigured()).rejects.toThrow(/NEXT_PRIVATE_SINGLE_ORGANISATION_ID/);
  });

  it('fails loudly when the configured organisation has no team', async () => {
    mocks.organisationFindUnique.mockResolvedValue(configuredOrganisation({ teams: [] }));

    await expect(assertSingleOrganisationConfigured()).rejects.toThrow(/no team/);
  });

  it('fails loudly when the first team does not include organisation members', async () => {
    mocks.organisationFindUnique.mockResolvedValue(
      configuredOrganisation({ teams: [{ id: 7, teamGroups: [{ organisationGroupId: 'group_admin' }] }] }),
    );

    await expect(assertSingleOrganisationConfigured()).rejects.toThrow(/inherit/);
  });

  it('passes for a valid organisation', async () => {
    mocks.organisationFindUnique.mockResolvedValue(configuredOrganisation());

    await expect(assertSingleOrganisationConfigured()).resolves.toBeUndefined();
  });
});

describe('joinSingleOrganisation', () => {
  it('does nothing when the mode is off', async () => {
    vi.stubEnv('NEXT_PRIVATE_SINGLE_ORGANISATION_ID', '');

    await joinSingleOrganisation({ userId: 1 });

    expect(mocks.organisationFindUnique).not.toHaveBeenCalled();
    expect(mocks.addUserToOrganisation).not.toHaveBeenCalled();
  });

  it('adds a user who is not yet a member with the member role', async () => {
    mocks.organisationFindUnique.mockResolvedValue(configuredOrganisation());
    mocks.organisationMemberFindFirst.mockResolvedValue(null);

    await joinSingleOrganisation({ userId: 1 });

    expect(mocks.addUserToOrganisation).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        organisationId: ORG_ID,
        organisationMemberRole: OrganisationMemberRole.MEMBER,
      }),
    );
  });

  it('does not add a user who is already a member', async () => {
    mocks.organisationFindUnique.mockResolvedValue(configuredOrganisation());
    mocks.organisationMemberFindFirst.mockResolvedValue({ id: 'member_1' });

    await joinSingleOrganisation({ userId: 1 });

    expect(mocks.addUserToOrganisation).not.toHaveBeenCalled();
  });

  it('treats a concurrent join that already created the membership as success', async () => {
    mocks.organisationFindUnique.mockResolvedValue(configuredOrganisation());
    mocks.organisationMemberFindFirst.mockResolvedValue(null);
    mocks.addUserToOrganisation.mockRejectedValue(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));

    await expect(joinSingleOrganisation({ userId: 1 })).resolves.toBeUndefined();
  });

  it('propagates any other failure so the sign-in fails', async () => {
    mocks.organisationFindUnique.mockResolvedValue(configuredOrganisation());
    mocks.organisationMemberFindFirst.mockResolvedValue(null);
    mocks.addUserToOrganisation.mockRejectedValue(new Error('database down'));

    await expect(joinSingleOrganisation({ userId: 1 })).rejects.toThrow('database down');
  });

  it('fails when the configured organisation does not exist', async () => {
    mocks.organisationFindUnique.mockResolvedValue(null);

    await expect(joinSingleOrganisation({ userId: 1 })).rejects.toThrow(/NEXT_PRIVATE_SINGLE_ORGANISATION_ID/);
  });
});

describe('assertTeamInSingleOrganisation', () => {
  it('does nothing when the mode is off', async () => {
    vi.stubEnv('NEXT_PRIVATE_SINGLE_ORGANISATION_ID', '');

    await assertTeamInSingleOrganisation({ teamId: 99 });

    expect(mocks.teamFindUnique).not.toHaveBeenCalled();
  });

  it('allows a team inside the configured organisation', async () => {
    mocks.teamFindUnique.mockResolvedValue({ organisationId: ORG_ID });

    await expect(assertTeamInSingleOrganisation({ teamId: 7 })).resolves.toBeUndefined();
  });

  it('refuses a team in any other organisation', async () => {
    mocks.teamFindUnique.mockResolvedValue({ organisationId: 'org_personal' });

    await expect(assertTeamInSingleOrganisation({ teamId: 8 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses a team that does not exist', async () => {
    mocks.teamFindUnique.mockResolvedValue(null);

    await expect(assertTeamInSingleOrganisation({ teamId: 8 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('assertCanCreateOrganisationOrTeam', () => {
  it('does nothing when the mode is off', async () => {
    vi.stubEnv('NEXT_PRIVATE_SINGLE_ORGANISATION_ID', '');

    await assertCanCreateOrganisationOrTeam({ userId: 1 });

    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });

  it('refuses a user who is not an instance administrator', async () => {
    mocks.userFindUnique.mockResolvedValue({ roles: [Role.USER] });

    await expect(assertCanCreateOrganisationOrTeam({ userId: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows an instance administrator', async () => {
    mocks.userFindUnique.mockResolvedValue({ roles: [Role.USER, Role.ADMIN] });

    await expect(assertCanCreateOrganisationOrTeam({ userId: 1 })).resolves.toBeUndefined();
  });
});
