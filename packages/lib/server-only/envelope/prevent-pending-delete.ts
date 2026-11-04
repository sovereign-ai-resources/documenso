import type { Envelope } from '@prisma/client';
import { DocumentStatus } from '@prisma/client';

import type { ApiRequestMetadata } from '../../universal/extract-request-metadata';
import { env } from '../../utils/env';
import type { EnvelopeIdOptions } from '../../utils/envelope';
import { cancelDocument } from '../document/cancel-document';

/**
 * With `NEXT_PRIVATE_PREVENT_PENDING_DELETE=true`, deleting a pending
 * document cancels it instead of hard-deleting it, so its partial signatures
 * and audit trail are kept. Cancelling goes through the normal cancel flow,
 * which records the cancellation in the audit log, emails recipients, and
 * fires the `DOCUMENT_CANCELLED` webhook.
 *
 * Drafts are still hard-deleted. Completed, rejected and cancelled documents
 * are already soft-deleted upstream.
 */
export const isPreventPendingDeleteEnabled = () => env('NEXT_PRIVATE_PREVENT_PENDING_DELETE') === 'true';

type CancelPendingInsteadOfDeleteOptions<T extends Pick<Envelope, 'status'>> = {
  hasDeleteAccess: boolean;
  envelope: T;
  id: EnvelopeIdOptions;
  userId: number;
  teamId: number;
  requestMetadata: ApiRequestMetadata;
};

/**
 * Returns the cancelled envelope when the delete was turned into a cancel, or
 * null when the caller should delete as usual. Users without delete access
 * (recipients hiding a document) are never routed into a cancel.
 */
export const cancelPendingInsteadOfDelete = async <T extends Pick<Envelope, 'status'>>({
  hasDeleteAccess,
  envelope,
  id,
  userId,
  teamId,
  requestMetadata,
}: CancelPendingInsteadOfDeleteOptions<T>) => {
  if (!hasDeleteAccess || !isPreventPendingDeleteEnabled() || envelope.status !== DocumentStatus.PENDING) {
    return null;
  }

  const cancelledEnvelope = await cancelDocument({ id, userId, teamId, requestMetadata });

  return {
    ...envelope,
    status: cancelledEnvelope.status,
    completedAt: cancelledEnvelope.completedAt,
  };
};
