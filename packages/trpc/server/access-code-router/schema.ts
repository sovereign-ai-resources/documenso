import { z } from 'zod';

export const ZGetAccessCodeSignerStatusRequestSchema = z.object({
  token: z.string().min(1),
});

export const ZGetAccessCodeSignerStatusResponseSchema = z.object({
  required: z.boolean(),
  issued: z.boolean(),
  locked: z.boolean(),
  verified: z.boolean(),
});

export const ZVerifyAccessCodeRequestSchema = z.object({
  token: z.string().min(1),
  code: z.string().min(1).max(256),
});

export const ZVerifyAccessCodeResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('VERIFIED') }),
  z.object({ status: z.literal('INVALID'), attemptsRemaining: z.number() }),
  z.object({ status: z.literal('LOCKED') }),
  z.object({ status: z.literal('NOT_SET') }),
]);

export const ZSetRecipientAccessCodeRequestSchema = z.object({
  envelopeId: z.string().min(1),
  recipientId: z.number(),
  enabled: z.boolean(),
  code: z.string().max(256).optional(),
});

export const ZSetRecipientAccessCodeResponseSchema = z.object({
  enabled: z.boolean(),
});

export type TVerifyAccessCodeResponse = z.infer<typeof ZVerifyAccessCodeResponseSchema>;
