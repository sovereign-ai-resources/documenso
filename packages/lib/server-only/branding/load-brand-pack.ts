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
 * Read and validate the brand pack, then publish it as `NEXT_PUBLIC_BRAND` so
 * server code and (through the public env) the browser see the same values.
 *
 * Returns `null` and leaves the environment untouched when no pack is present.
 * Throws when the pack is present but invalid, so a broken pack stops startup
 * instead of serving a half-branded app.
 */
export const loadBrandPack = (cwd?: string): TBrandPack | null => {
  const packPath = getBrandPackPath(cwd);

  if (!fs.existsSync(packPath)) {
    return null;
  }

  const result = ZBrandPackSchema.safeParse(JSON.parse(fs.readFileSync(packPath, 'utf8')));

  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);

    throw new Error(`Invalid brand pack at ${packPath}: ${problems.join('; ')}`);
  }

  process.env.NEXT_PUBLIC_BRAND = JSON.stringify(result.data);

  return result.data;
};
