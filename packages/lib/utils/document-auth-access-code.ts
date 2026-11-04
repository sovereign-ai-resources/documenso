import type { TDocumentAccessAuthTypes, TRecipientAccessAuthTypes } from '../types/document-auth';
import { DocumentAuth } from '../types/document-auth';

/**
 * An access code adds to the document's access methods rather than replacing
 * them, so a recipient whose only own method is the code still inherits the
 * document's methods.
 */
export const deriveRecipientAccessAuthWithAccessCode = (
  recipientAccessAuth: TRecipientAccessAuthTypes[],
  globalAccessAuth: TDocumentAccessAuthTypes[],
): TRecipientAccessAuthTypes[] => {
  const ownMethods = recipientAccessAuth.filter((method) => method !== DocumentAuth.ACCESS_CODE);

  if (ownMethods.length > 0) {
    return recipientAccessAuth;
  }

  if (ownMethods.length === recipientAccessAuth.length) {
    return globalAccessAuth;
  }

  return [...globalAccessAuth, DocumentAuth.ACCESS_CODE];
};
