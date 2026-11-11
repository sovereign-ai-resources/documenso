import type { SourceOffer } from '../../constants/source-offer';

const REQUIRED = ['NEXT_PUBLIC_SOURCE_REPOSITORY_URL', 'NEXT_PUBLIC_SOURCE_COMMIT'] as const;

export type SourceOfferStartupDecision =
  | { action: 'ok' }
  | { action: 'warn'; missing: string[] }
  | { action: 'fail'; missing: string[] };

/**
 * A branded build must offer its Corresponding Source to every user, so it
 * refuses to start without the repository URL and commit that make the offer.
 * An explicit opt-out downgrades that to a warning for local use. An unbranded
 * build is never checked, so it starts exactly as upstream does.
 */
export const decideSourceOfferStartup = ({
  isBranded,
  offer,
  allowMissing,
  env,
}: {
  isBranded: boolean;
  offer: SourceOffer | null;
  allowMissing: boolean;
  env: Record<string, string | undefined>;
}): SourceOfferStartupDecision => {
  if (!isBranded || offer) {
    return { action: 'ok' };
  }

  const missing = REQUIRED.filter((name) => !env[name]?.trim());

  return { action: allowMissing ? 'warn' : 'fail', missing };
};
