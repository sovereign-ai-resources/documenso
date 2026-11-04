import { prisma } from '@documenso/prisma';
import { DocumentStatus, EnvelopeType, type Prisma } from '@prisma/client';
import { ACCESS_CODE_MAX_FAILED_ATTEMPTS } from '../../constants/access-code';
import { AppError, AppErrorCode } from '../../errors/app-error';
import type { TAccessCodeAuditOutcome } from '../../types/document-audit-log-access-code';
import { DOCUMENT_AUDIT_LOG_TYPE } from '../../types/document-audit-logs';
import { type TRecipientAuthOptions, ZRecipientAuthOptionsSchema } from '../../types/document-auth';
import type { RequestMetadata } from '../../universal/extract-request-metadata';
import { createDocumentAuditLogData } from '../../utils/document-audit-logs';
import { logger } from '../../utils/logger';
import {
  getAccessCodeState,
  isAccessCodeMatch,
  recipientRequiresAccessCode,
  serializeAccessCodeCookie,
  type TRecipientAccessCode,
} from './access-code';
import { sendAccessCodeLockedEmail } from './send-access-code-locked-email';

export type VerifyAccessCodeResult =
  | { status: 'VERIFIED'; setCookie: string }
  | { status: 'INVALID'; attemptsRemaining: number }
  | { status: 'LOCKED' }
  | { status: 'NOT_SET' };

type AuditRecipient = { id: number; name: string; email: string; envelopeId: string };

const createAuditLog = (
  tx: Prisma.TransactionClient,
  recipient: AuditRecipient,
  outcome: TAccessCodeAuditOutcome,
  requestMetadata?: RequestMetadata,
) =>
  tx.documentAuditLog.create({
    data: createDocumentAuditLogData({
      type: DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_ACCESS_AUTH_ACCESS_CODE,
      envelopeId: recipient.envelopeId,
      user: outcome === 'LOCKED' ? undefined : { name: recipient.name, email: recipient.email },
      requestMetadata,
      data: {
        recipientId: recipient.id,
        recipientName: recipient.name,
        recipientEmail: recipient.email,
        method: 'ACCESS_CODE',
        outcome,
      },
    }),
  });

/**
 * Checks a recipient's access code. Attempts for one recipient are serialized
 * with a row lock so parallel guesses cannot slip past the failure counter.
 *
 * After the maximum number of failures the code stays locked, whatever is
 * entered, until the sender sets a new one; the sender is emailed when that
 * happens.
 */
export const verifyAccessCode = async ({
  token,
  code,
  requestMetadata,
}: {
  token: string;
  code: string;
  requestMetadata?: RequestMetadata;
}): Promise<VerifyAccessCodeResult> => {
  const found = await prisma.recipient.findFirst({
    where: {
      token,
      envelope: { type: EnvelopeType.DOCUMENT, status: { not: DocumentStatus.DRAFT } },
    },
    select: { id: true },
  });

  if (!found) {
    throw new AppError(AppErrorCode.NOT_FOUND, { message: 'Recipient not found' });
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Recipient" WHERE "id" = ${found.id} FOR UPDATE`;

    const recipient = await tx.recipient.findUniqueOrThrow({
      where: { id: found.id },
      select: { id: true, name: true, email: true, envelopeId: true, authOptions: true },
    });

    const state = getAccessCodeState(recipient.authOptions);

    if (!recipientRequiresAccessCode(recipient.authOptions) || !state) {
      return { status: 'NOT_SET' } as const;
    }

    if (state.locked) {
      return { status: 'LOCKED', justLocked: null } as const;
    }

    const saveState = async (accessCode: TRecipientAccessCode) => {
      const authOptions: TRecipientAuthOptions & { accessCode: TRecipientAccessCode } = {
        ...ZRecipientAuthOptionsSchema.parse(recipient.authOptions),
        accessCode,
      };

      await tx.recipient.update({ where: { id: recipient.id }, data: { authOptions } });
    };

    if (await isAccessCodeMatch(code, state)) {
      if (state.failedAttempts > 0) {
        await saveState({ ...state, failedAttempts: 0 });
      }

      await createAuditLog(tx, recipient, 'VALIDATED', requestMetadata);

      return { status: 'VERIFIED', state } as const;
    }

    const failedAttempts = state.failedAttempts + 1;
    const locked = failedAttempts >= ACCESS_CODE_MAX_FAILED_ATTEMPTS;

    await saveState({ ...state, failedAttempts, locked });
    await createAuditLog(tx, recipient, 'FAILED', requestMetadata);

    if (locked) {
      await createAuditLog(tx, recipient, 'LOCKED', requestMetadata);

      return { status: 'LOCKED', justLocked: { envelopeId: recipient.envelopeId, recipientId: recipient.id } } as const;
    }

    return { status: 'INVALID', attemptsRemaining: ACCESS_CODE_MAX_FAILED_ATTEMPTS - failedAttempts } as const;
  });

  if (result.status === 'VERIFIED') {
    return { status: 'VERIFIED', setCookie: serializeAccessCodeCookie({ token, state: result.state }) };
  }

  if (result.status === 'LOCKED') {
    if (result.justLocked) {
      await sendAccessCodeLockedEmail(result.justLocked).catch((error) => {
        logger.error({ msg: 'Failed to send access code locked email', error });
      });
    }

    return { status: 'LOCKED' };
  }

  return result;
};
