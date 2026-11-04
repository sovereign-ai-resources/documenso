import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { match } from 'ts-pattern';
import { z } from 'zod';

/**
 * Audit log event for the access code access method. Records the method and
 * the outcome, never the code.
 *
 * The type literal is spelled out rather than imported so the audit log types
 * module can import this file without a circular dependency.
 */
export const DOCUMENT_AUDIT_LOG_TYPE_ACCESS_CODE = 'DOCUMENT_ACCESS_AUTH_ACCESS_CODE' as const;

export const ZAccessCodeAuditOutcomeSchema = z.enum(['SET', 'VALIDATED', 'FAILED', 'LOCKED']);

export type TAccessCodeAuditOutcome = z.infer<typeof ZAccessCodeAuditOutcomeSchema>;

export const ZDocumentAuditLogEventAccessCodeSchema = z.object({
  type: z.literal(DOCUMENT_AUDIT_LOG_TYPE_ACCESS_CODE),
  data: z.object({
    recipientEmail: z.string(),
    recipientName: z.string(),
    recipientId: z.number(),
    method: z.literal('ACCESS_CODE'),
    outcome: ZAccessCodeAuditOutcomeSchema,
  }),
});

export type TDocumentAuditLogEventAccessCode = z.infer<typeof ZDocumentAuditLogEventAccessCodeSchema>;

export const formatAccessCodeAuditLog = (
  data: TDocumentAuditLogEventAccessCode['data'],
  user: string,
): { anonymous: MessageDescriptor; you: MessageDescriptor; user: MessageDescriptor } => {
  const recipient = data.recipientName || data.recipientEmail;

  return match(data.outcome)
    .with('SET', () => ({
      anonymous: msg`An access code was set for ${recipient}`,
      you: msg`You set an access code for ${recipient}`,
      user: msg`${user} set an access code for ${recipient}`,
    }))
    .with('VALIDATED', () => ({
      anonymous: msg`Recipient entered the correct access code`,
      you: msg`You entered the correct access code`,
      user: msg`${user} entered the correct access code`,
    }))
    .with('FAILED', () => ({
      anonymous: msg`Recipient entered an incorrect access code`,
      you: msg`You entered an incorrect access code`,
      user: msg`${user} entered an incorrect access code`,
    }))
    .with('LOCKED', () => ({
      anonymous: msg`Access code locked for ${recipient} after too many incorrect attempts`,
      you: msg`Access code locked for ${recipient} after too many incorrect attempts`,
      user: msg`Access code locked for ${recipient} after too many incorrect attempts`,
    }))
    .exhaustive();
};
