import {
  getAccessCodeState,
  isAccessCodeVerifiedFromHeaders,
  recipientRequiresAccessCode,
} from '@documenso/lib/server-only/access-code/access-code';
import { setRecipientAccessCode } from '@documenso/lib/server-only/access-code/set-recipient-access-code';
import { verifyAccessCode } from '@documenso/lib/server-only/access-code/verify-access-code';
import { prisma } from '@documenso/prisma';
import { DocumentStatus, EnvelopeType } from '@prisma/client';
import { getContext } from 'hono/context-storage';

import { authenticatedProcedure, procedure, router } from '../trpc';
import {
  ZGetAccessCodeSignerStatusRequestSchema,
  ZGetAccessCodeSignerStatusResponseSchema,
  ZSetRecipientAccessCodeRequestSchema,
  ZSetRecipientAccessCodeResponseSchema,
  ZVerifyAccessCodeRequestSchema,
  ZVerifyAccessCodeResponseSchema,
} from './schema';

/**
 * Access code procedures. Signer procedures are public and keyed by the
 * recipient token; they are internal and not part of the public API.
 */
export const accessCodeRouter = router({
  getSignerStatus: procedure
    .input(ZGetAccessCodeSignerStatusRequestSchema)
    .output(ZGetAccessCodeSignerStatusResponseSchema)
    .query(async ({ input, ctx }) => {
      const recipient = await prisma.recipient.findFirst({
        where: {
          token: input.token,
          envelope: { type: EnvelopeType.DOCUMENT, status: { not: DocumentStatus.DRAFT } },
        },
        select: { token: true, authOptions: true },
      });

      if (!recipient || !recipientRequiresAccessCode(recipient.authOptions)) {
        return { required: false, issued: false, locked: false, verified: false };
      }

      const state = getAccessCodeState(recipient.authOptions);

      return {
        required: true,
        issued: state !== null,
        locked: state?.locked ?? false,
        verified: isAccessCodeVerifiedFromHeaders(recipient, ctx.req.headers),
      };
    }),

  verify: procedure
    .input(ZVerifyAccessCodeRequestSchema)
    .output(ZVerifyAccessCodeResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const result = await verifyAccessCode({
        token: input.token,
        code: input.code,
        requestMetadata: ctx.metadata.requestMetadata,
      });

      if (result.status === 'VERIFIED') {
        getContext().header('Set-Cookie', result.setCookie, { append: true });

        return { status: 'VERIFIED' as const };
      }

      return result;
    }),

  setRecipientCode: authenticatedProcedure
    .input(ZSetRecipientAccessCodeRequestSchema)
    .output(ZSetRecipientAccessCodeResponseSchema)
    .mutation(async ({ input, ctx }) => {
      ctx.logger.info({
        input: {
          envelopeId: input.envelopeId,
          recipientId: input.recipientId,
          enabled: input.enabled,
        },
      });

      return await setRecipientAccessCode({
        userId: ctx.user.id,
        teamId: ctx.teamId ?? -1,
        envelopeId: input.envelopeId,
        recipientId: input.recipientId,
        enabled: input.enabled,
        code: input.code,
        requestMetadata: ctx.metadata,
      });
    }),
});
