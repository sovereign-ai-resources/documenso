import { prisma } from '@documenso/prisma';
import { OrganisationGroupType, OrganisationMemberRole } from '@prisma/client';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { env } from '../../utils/env';
import { isAdmin } from '../../utils/is-admin';
import { logger } from '../../utils/logger';
import { addUserToOrganisation } from '../organisation/accept-organisation-invitation';

/**
 * Single-organisation mode.
 *
 * When `NEXT_PRIVATE_SINGLE_ORGANISATION_ID` is set, every user works inside
 * that one organisation:
 *
 * - new users get no personal organisation;
 * - every successful sign-in makes sure the user is a member of the
 *   organisation (so users created before the flag was set are joined too),
 *   and a failed join fails the sign-in;
 * - only instance administrators can create organisations or teams;
 * - documents and templates can only be created or sent from teams in the
 *   configured organisation.
 *
 * Every user who can sign in is joined, so restrict who can sign up
 * (`NEXT_PUBLIC_DISABLE_SIGNUP`, `NEXT_PRIVATE_ALLOWED_SIGNUP_DOMAINS`).
 *
 * Unset, every function here is a no-op and upstream behaviour is unchanged.
 */

const ENV_NAME = 'NEXT_PRIVATE_SINGLE_ORGANISATION_ID';

export const getSingleOrganisationId = () => {
  const value = env(ENV_NAME)?.trim();

  return value ? value : null;
};

export const isSingleOrganisationMode = () => getSingleOrganisationId() !== null;

const misconfigured = (organisationId: string, problem: string) =>
  new AppError(AppErrorCode.NOT_SETUP, {
    message: `${ENV_NAME} is set to "${organisationId}", but ${problem}.`,
  });

/**
 * Loads the configured organisation and checks it can receive members: it
 * exists, it has a team, and its first team inherits the organisation's
 * member group, so a joined member can work in that team.
 */
const getConfiguredOrganisation = async (organisationId: string) => {
  const organisation = await prisma.organisation.findUnique({
    where: { id: organisationId },
    select: {
      id: true,
      groups: true,
      teams: {
        orderBy: { id: 'asc' },
        take: 1,
        select: {
          id: true,
          teamGroups: {
            select: { organisationGroupId: true },
          },
        },
      },
    },
  });

  if (!organisation) {
    throw misconfigured(organisationId, 'no organisation has that id');
  }

  const [firstTeam] = organisation.teams;

  if (!firstTeam) {
    throw misconfigured(organisationId, 'that organisation has no team');
  }

  const memberGroup = organisation.groups.find(
    (group) =>
      group.type === OrganisationGroupType.INTERNAL_ORGANISATION &&
      group.organisationRole === OrganisationMemberRole.MEMBER,
  );

  const teamIncludesMembers =
    memberGroup !== undefined &&
    firstTeam.teamGroups.some((teamGroup) => teamGroup.organisationGroupId === memberGroup.id);

  if (!teamIncludesMembers) {
    throw misconfigured(
      organisationId,
      `its first team (id ${firstTeam.id}) does not inherit organisation members, so joined users could not use it`,
    );
  }

  return organisation;
};

/**
 * Throws when the mode is on and the configured organisation is unusable.
 */
export const assertSingleOrganisationConfigured = async () => {
  const organisationId = getSingleOrganisationId();

  if (!organisationId) {
    return;
  }

  await getConfiguredOrganisation(organisationId);
};

/**
 * Startup check: a misconfigured organisation stops the server instead of
 * leaving every sign-in to fail.
 */
export const verifySingleOrganisationOnStartup = async () => {
  try {
    await assertSingleOrganisationConfigured();
  } catch (err) {
    logger.fatal({ msg: 'Single-organisation mode is misconfigured; refusing to start.', err });

    process.exit(1);
  }
};

/**
 * Makes sure the user is a member of the configured organisation. Safe to
 * call on every sign-in.
 */
export const joinSingleOrganisation = async ({ userId }: { userId: number }) => {
  const organisationId = getSingleOrganisationId();

  if (!organisationId) {
    return;
  }

  const organisation = await getConfiguredOrganisation(organisationId);

  const existingMember = await prisma.organisationMember.findFirst({
    where: { userId, organisationId },
    select: { id: true },
  });

  if (existingMember) {
    return;
  }

  try {
    await addUserToOrganisation({
      userId,
      organisationId,
      organisationGroups: organisation.groups,
      organisationMemberRole: OrganisationMemberRole.MEMBER,
    });
  } catch (err) {
    // A concurrent sign-in created the membership first.
    if (err instanceof Error && 'code' in err && err.code === 'P2002') {
      return;
    }

    throw err;
  }
};

/**
 * Refuses document and template work in teams outside the configured
 * organisation.
 */
export const assertTeamInSingleOrganisation = async ({ teamId }: { teamId: number }) => {
  const organisationId = getSingleOrganisationId();

  if (!organisationId) {
    return;
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { organisationId: true },
  });

  if (team?.organisationId !== organisationId) {
    throw new AppError(AppErrorCode.FORBIDDEN, {
      message: 'Documents and templates can only be created and sent in the configured organisation.',
    });
  }
};

/**
 * Only instance administrators may create organisations or teams.
 */
export const assertCanCreateOrganisationOrTeam = async ({ userId }: { userId: number }) => {
  if (!isSingleOrganisationMode()) {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { roles: true },
  });

  if (!user || !isAdmin(user)) {
    throw new AppError(AppErrorCode.FORBIDDEN, {
      message: 'Only administrators can create organisations or teams on this instance.',
    });
  }
};
