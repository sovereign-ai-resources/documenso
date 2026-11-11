import { z } from 'zod';

const HEX_COLOR_REGEX = /^#[0-9a-f]{6}$/i;

const ZHexColor = z.string().regex(HEX_COLOR_REGEX, 'must be a #rrggbb hex color');

/**
 * Brand-pack text must not carry addresses: domains and other deployment
 * identifiers belong in environment variables, never in a pack committed to
 * a public repository.
 */
const ZBrandText = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !/:\/\/|www\./i.test(value), 'must not contain a URL; put addresses in environment variables');

/**
 * Overrides for the email colour tokens (the keys of `DEFAULT_BRAND_COLORS`).
 */
export const ZBrandEmailColorsSchema = z
  .object({
    primary: ZHexColor,
    primaryForeground: ZHexColor,
    ring: ZHexColor,
    fieldCard: ZHexColor,
    fieldCardBorder: ZHexColor,
  })
  .partial()
  .strict();

/**
 * Shape of `public/brand/brand.json` in a brand pack. Logo, icon and
 * stylesheet files live beside it at fixed names (see `BRAND_ASSET_PATHS`).
 */
export const ZBrandPackSchema = z
  .object({
    name: ZBrandText,
    legalName: ZBrandText,
    companyDetails: ZBrandText.optional(),
    emailColors: ZBrandEmailColorsSchema.optional(),
  })
  .strict();

export type TBrandPack = z.infer<typeof ZBrandPackSchema>;
