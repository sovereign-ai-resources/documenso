import { getBasePath } from '@documenso/lib/constants/app';
import { SOURCE_OFFER } from '@documenso/lib/constants/source-offer';
import { Trans } from '@lingui/react/macro';

/**
 * Offers the deployment's Corresponding Source. Sits in the normal page flow
 * after the content, never fixed or overlaid. The credit stays plain text so
 * brand text replacement never rewrites it.
 */
export const SourceOffer = () => {
  if (!SOURCE_OFFER()) {
    return null;
  }

  return (
    <p className="px-4 py-3 text-center text-muted-foreground text-xs">
      <a href={`${getBasePath()}/source`} target="_blank" rel="noopener noreferrer" className="underline">
        <Trans>Source code</Trans>
      </a>
      {' · '}
      <span>Based on Documenso (AGPL-3.0)</span>
    </p>
  );
};
