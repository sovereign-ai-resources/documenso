import { SOURCE_OFFER } from '@documenso/lib/constants/source-offer';
import { redirect } from 'react-router';

// Sends users to the exact source this deployment runs (AGPL-3.0 section 13).
export function loader() {
  const offer = SOURCE_OFFER();

  if (!offer) {
    throw new Response('Not Found', { status: 404 });
  }

  return redirect(offer.treeUrl, 302);
}
