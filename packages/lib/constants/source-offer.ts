import { env } from '../utils/env';

export type SourceOffer = {
  repositoryUrl: string;
  commit: string;
  /** The repository browsed at the exact deployed commit. */
  treeUrl: string;
};

/**
 * The offer of this deployment's Corresponding Source (AGPL-3.0 section 13):
 * the public repository from `NEXT_PUBLIC_SOURCE_REPOSITORY_URL` at the commit
 * baked into the image as `NEXT_PUBLIC_SOURCE_COMMIT`.
 *
 * Returns `null` unless both are set.
 */
export const SOURCE_OFFER = (): SourceOffer | null => {
  const repositoryUrl = env('NEXT_PUBLIC_SOURCE_REPOSITORY_URL')?.trim().replace(/\/+$/, '');
  const commit = env('NEXT_PUBLIC_SOURCE_COMMIT')?.trim();

  if (!repositoryUrl || !commit) {
    return null;
  }

  return { repositoryUrl, commit, treeUrl: `${repositoryUrl}/tree/${commit}` };
};
