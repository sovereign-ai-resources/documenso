import fs from 'node:fs';
import path from 'node:path';

import { type TBrandPack, ZBrandPackSchema } from '../../types/brand';

/**
 * Where a build's selected brand pack leaves its definition. The Docker build
 * copies the pack's `public/` folder over the app's, so this file exists only
 * in a branded image.
 */
export const getBrandPackPath = (cwd = process.cwd()) => path.join(cwd, 'public/brand/brand.json');

/**
 * Validate a brand pack's JSON, naming every bad field and where it came from.
 */
export const parseBrandPack = (raw: string, source: string): TBrandPack => {
  const result = ZBrandPackSchema.safeParse(JSON.parse(raw));

  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);

    throw new Error(`Invalid brand pack at ${source}: ${problems.join('; ')}`);
  }

  return result.data;
};

/**
 * Read and validate the brand pack, then publish it as `NEXT_PUBLIC_BRAND` so
 * server code and (through the public env) the browser see the same values.
 *
 * Returns `null` when no pack is present, and clears any `NEXT_PUBLIC_BRAND`
 * set by hand: a brand without its pack would serve missing assets and skip
 * the source-offer startup check, which keys on the pack.
 * Throws when the pack is present but invalid, so a broken pack stops startup
 * instead of serving a half-branded app.
 */
export const loadBrandPack = (cwd?: string): TBrandPack | null => {
  const packPath = getBrandPackPath(cwd);

  if (!fs.existsSync(packPath)) {
    delete process.env.NEXT_PUBLIC_BRAND;

    return null;
  }

  const pack = parseBrandPack(fs.readFileSync(packPath, 'utf8'), packPath);

  process.env.NEXT_PUBLIC_BRAND = JSON.stringify(pack);

  return pack;
};
