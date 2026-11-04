import { prisma } from '@documenso/prisma';
import { DocumentStatus, EnvelopeType, RecipientRole, SigningStatus } from '@prisma/client';

import { ACCESS_CODE_MIN_LENGTH, IS_ACCESS_CODE_ENABLED } from '../../constants/access-code';
import { AppError, AppErrorCode } from '../../errors/app-error';
import { DOCUMENT_AUDIT_LOG_TYPE } from '../../types/document-audit-logs';
import { DocumentAuth, ZRecipientAuthOptionsSchema } from '../../types/document-auth';
import type { ApiRequestMetadata } from '../../universal/extract-request-metadata';
import { createDocumentAuditLogData, diffRecipientChanges } from '../../utils/document-audit-logs';
import { getEnvelopeWhereInput } from '../envelope/get-envelope-by-id';
import {
  createAccessCodeState,
  getAccessCodeWeakness,
  type TAccessCodeWeakness,
  withoutAccessCodeMethod,
} from './access-code';

const WEAKNESS_MESSAGES: Record<TAccessCodeWeakness, string> = {
  TOO_SHORT: `The access code must be at least ${ACCESS_CODE_MIN_LENGTH} characters.`,
  TOO_LONG: 'The access code is too long.',
  REPEATED: 'The access code cannot be a single repeated character.',
  SEQUENTIAL: 'The access code cannot be a simple sequence.',
};

export type SetRecipientAccessCodeOptions = {
  userId: number;
  teamId: number;
  envelopeId: string;
  recipientId: number;
  enabled: boolean;
  /**
   * The code to issue. Required to enable it on a document; never accepted on
   * a template, which carries the setting only.
   */
  code?: string;
  requestMetadata: ApiRequestMetadata;
};

/**
 * Turns the access code requirement on or off for one recipient, and issues a
 * new code. Issuing a code also clears any failed attempts and a lock, so this
 * is how a sender resets a locked recipient.
 */
export const setRecipientAccessCode = async ({
  userId,
  teamId,
  envelopeId,
  recipientId,
  enabled,
  code,
  requestMetadata,
}: SetRecipientAccessCodeOptions) => {
  if (!IS_ACCESS_CODE_ENABLED()) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, { message: 'Access codes are not enabled' });
  }

  const { envelopeWhereInput } = await getEnvelopeWhereInput({
    id: { type: 'envelopeId', id: envelopeId },
    type: null,
    userId,
    teamId,
  });

  const envelope = await prisma.envelope.findFirst({
    where: envelopeWhereInput,
    include: { recipients: { where: { id: recipientId } } },
  });

  const recipient = envelope?.recipients[0];

  if (!envelope || !recipient) {
    throw new AppError(AppErrorCode.NOT_FOUND, { message: 'Recipient not found' });
  }

  if (
    envelope.deletedAt ||
    envelope.status === DocumentStatus.COMPLETED ||
    envelope.status === DocumentStatus.REJECTED
  ) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, { message: 'The document can no longer be changed' });
  }

  if (recipient.role === RecipientRole.CC || recipient.signingStatus !== SigningStatus.NOT_SIGNED) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'An access code can only be set for a recipient who has not yet acted',
    });
  }

  const isTemplate = envelope.type === EnvelopeType.TEMPLATE;

  if (isTemplate && code !== undefined) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Templates carry the access code setting only; set the code on each document',
    });
  }

  if (enabled && !isTemplate) {
    const weakness = code === undefined ? 'TOO_SHORT' : getAccessCodeWeakness(code);

    if (weakness) {
      throw new AppError(AppErrorCode.INVALID_BODY, { message: WEAKNESS_MESSAGES[weakness] });
    }
  }

  const current = ZRecipientAuthOptionsSchema.parse(recipient.authOptions);
  const accessAuth = withoutAccessCodeMethod(current.accessAuth);

  const authOptions = {
    accessAuth: enabled ? [...accessAuth, DocumentAuth.ACCESS_CODE] : accessAuth,
    actionAuth: current.actionAuth,
    ...(enabled && !isTemplate && code !== undefined ? { accessCode: await createAccessCodeState(code) } : {}),
  };

  await prisma.$transaction(async (tx) => {
    const updated = await tx.recipient.update({
      where: { id: recipient.id },
      data: { authOptions },
    });

    if (isTemplate) {
      return;
    }

    const changes = diffRecipientChanges(recipient, updated);

    if (changes.length > 0) {
      await tx.documentAuditLog.create({
        data: createDocumentAuditLogData({
          type: DOCUMENT_AUDIT_LOG_TYPE.RECIPIENT_UPDATED,
          envelopeId: envelope.id,
          metadata: requestMetadata,
          data: {
            recipientEmail: updated.email,
            recipientName: updated.name,
            recipientId: updated.id,
            recipientRole: updated.role,
            changes,
          },
        }),
      });
    }

    if (enabled) {
      await tx.documentAuditLog.create({
        data: createDocumentAuditLogData({
          type: DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_ACCESS_AUTH_ACCESS_CODE,
          envelopeId: envelope.id,
          metadata: requestMetadata,
          data: {
            recipientEmail: updated.email,
            recipientName: updated.name,
            recipientId: updated.id,
            method: 'ACCESS_CODE',
            outcome: 'SET',
          },
        }),
      });
    }
  });

  return { enabled };
};
