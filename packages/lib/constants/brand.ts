import { type TBrandPack, ZBrandPackSchema } from '../types/brand';
import { env } from '../utils/env';

/**
 * Brand values for a build that selected a brand pack.
 *
 * The server loads the pack once at startup and publishes it as
 * `NEXT_PUBLIC_BRAND` (see `load-brand-pack.ts`); the public-env injection in
 * the root layout carries the same value to the browser. Reading it here keeps
 * this module free of filesystem access, so client code can import it.
 *
 * With no pack selected every getter returns the upstream value.
 */

const UPSTREAM_NAME = 'Documenso';
const UPSTREAM_LEGAL_NAME = 'Documenso, Inc.';

/**
 * Files a brand pack provides under `public/brand/`, served from the app root.
 */
export const BRAND_ASSET_PATHS = {
  logoLight: '/brand/logo-light.svg',
  logoDark: '/brand/logo-dark.svg',
  iconLight: '/brand/icon-light.svg',
  iconDark: '/brand/icon-dark.svg',
  stylesheet: '/brand/brand.css',
} as const;

let cachedRaw: string | undefined;
let cachedPack: TBrandPack | null = null;

export const BRAND = (): TBrandPack | null => {
  const raw = env('NEXT_PUBLIC_BRAND');

  if (!raw) {
    return null;
  }

  if (raw !== cachedRaw) {
    cachedPack = ZBrandPackSchema.parse(JSON.parse(raw));
    cachedRaw = raw;
  }

  return cachedPack;
};

export const IS_BRANDED = () => BRAND() !== null;

export const BRAND_NAME = () => BRAND()?.name ?? UPSTREAM_NAME;

export const BRAND_LEGAL_NAME = () => BRAND()?.legalName ?? UPSTREAM_LEGAL_NAME;

export const BRAND_COMPANY_DETAILS = () => BRAND()?.companyDetails;

/**
 * The company block a branded email footer shows: the legal name, then any
 * company details. The organisation step stores the same text, so the footer
 * reads the same before and after it runs.
 */
export const BRAND_FOOTER_TEXT = () =>
  [BRAND_LEGAL_NAME(), BRAND_COMPANY_DETAILS()].filter((part): part is string => Boolean(part)).join('\n');

/**
 * The brand's public website, from `NEXT_PUBLIC_BRAND_WEBSITE_URL`.
 */
export const BRAND_WEBSITE_URL = () => env('NEXT_PUBLIC_BRAND_WEBSITE_URL')?.trim() || undefined;
