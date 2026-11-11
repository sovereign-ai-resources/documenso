import fs from 'node:fs/promises';
import path from 'node:path';

import { prisma } from '@documenso/prisma';

import { BRAND_FOOTER_TEXT, BRAND_WEBSITE_URL, IS_BRANDED } from '../../constants/brand';
import { env } from '../../utils/env';
import { logger } from '../../utils/logger';
import { getSingleOrganisationId } from '../user/single-organisation';
import { buildBrandingLogoData } from './store-branding-logo';

type OrganisationBrandingSettings = {
  brandingEnabled: boolean;
  brandingLogo: string;
  brandingUrl: string;
  brandingCompanyDetails: string;
};

/**
 * Branding is "at upstream defaults" while it is off and its logo, website and
 * company details are all empty. Anything else means an admin (or an earlier
 * run) has acted, and their choice stands, including turning branding off.
 */
export const shouldApplyBrand = ({
  settings,
  reapply,
}: {
  settings: OrganisationBrandingSettings;
  reapply: boolean;
}) => {
  if (reapply) {
    return true;
  }

  return (
    !settings.brandingEnabled &&
    settings.brandingLogo === '' &&
    settings.brandingUrl === '' &&
    settings.brandingCompanyDetails === ''
  );
};

/**
 * The settings the brand pack fills in. Company details carry the legal name,
 * because enabling branding switches the email footer to these details.
 */
export const getBrandOrganisationSettings = () => ({
  brandingEnabled: true,
  brandingUrl: BRAND_WEBSITE_URL() ?? '',
  brandingCompanyDetails: BRAND_FOOTER_TEXT(),
});

/**
 * Fills the single organisation's branding settings from the brand pack, once.
 * It never re-asserts on later starts, so Settings edits survive restarts.
 * `NEXT_PRIVATE_BRAND_REAPPLY=true` overwrites on every start while it is set,
 * so it is meant for one start after a pack change and then removed.
 *
 * Logs one line saying what it did and swallows its own errors.
 */
export const applyBrandToOrganisation = async () => {
  if (!IS_BRANDED()) {
    return;
  }

  try {
    const organisationId = getSingleOrganisationId();

    if (!organisationId) {
      logger.info({ msg: 'Brand organisation step skipped (no organisation id)' });

      return;
    }

    const organisation = await prisma.organisation.findUnique({
      where: { id: organisationId },
      select: { organisationGlobalSettings: true },
    });

    // The single-organisation startup check already stops the server for this.
    if (!organisation) {
      return;
    }

    const { organisationGlobalSettings: settings } = organisation;
    const reapply = env('NEXT_PRIVATE_BRAND_REAPPLY') === 'true';

    if (!shouldApplyBrand({ settings, reapply })) {
      logger.info({ msg: 'Brand organisation step skipped (already customized)' });

      return;
    }

    const logo = await fs.readFile(path.join(process.cwd(), 'public/static/logo.png'));

    await prisma.organisationGlobalSettings.update({
      where: { id: settings.id },
      data: {
        ...getBrandOrganisationSettings(),
        brandingLogo: await buildBrandingLogoData(new File([new Uint8Array(logo)], 'logo.png', { type: 'image/png' })),
      },
    });

    if (reapply) {
      logger.warn({
        msg: 'Brand organisation step re-applied; remove NEXT_PRIVATE_BRAND_REAPPLY so Settings edits survive restarts',
      });
    } else {
      logger.info({ msg: 'Brand organisation step applied' });
    }
  } catch (err) {
    logger.error({ msg: 'Brand organisation step failed', err });
  }
};
