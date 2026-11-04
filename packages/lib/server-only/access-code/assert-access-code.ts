import { prisma } from '@documenso/prisma';
import { SigningStatus } from '@prisma/client';
import { tryGetContext } from 'hono/context-storage';

import { AppError, AppErrorCode } from '../../errors/app-error';
import {
  type AccessCodeRecipient,
  getAccessCodeState,
  isAccessCodeVerifiedFromHeaders,
  recipientRequiresAccessCode,
} from './access-code';

/**
 * Headers of the request being served, read from the Hono request context.
 * Undefined outside a request (jobs, scripts), which never counts as verified.
 */
const getCurrentRequestHeaders = () => tryGetContext()?.req.raw.headers;

/**
 * Whether the current request may act for this recipient as far as the
 * access code is concerned: true when no code is required, or when this
 * browser has verified the current code.
 */
export const isAccessCodeSatisfied = (recipient: AccessCodeRecipient, headers = getCurrentRequestHeaders()) =>
  !recipientRequiresAccessCode(recipient.authOptions) || isAccessCodeVerifiedFromHeaders(recipient, headers);

const accessCodeRequiredError = () =>
  new AppError(AppErrorCode.UNAUTHORIZED, {
    message: 'Access code required',
    statusCode: 401,
  });

export const assertAccessCodeVerified = (recipient: AccessCodeRecipient, headers?: Headers) => {
  if (!isAccessCodeSatisfied(recipient, headers)) {
    throw accessCodeRequiredError();
  }
};

/**
 * Looks the recipient up by token and checks the access code. Unknown tokens
 * count as satisfied so the caller keeps its own not-found handling.
 */
export const isAccessCodeSatisfiedForToken = async (token: string, headers?: Headers) => {
  const recipient = await prisma.recipient.findFirst({
    where: { token },
    select: { token: true, authOptions: true },
  });

  return !recipient || isAccessCodeSatisfied(recipient, headers);
};

export const assertAccessCodeVerifiedForToken = async (token: string, headers?: Headers) => {
  if (!(await isAccessCodeSatisfiedForToken(token, headers))) {
    throw accessCodeRequiredError();
  }
};

export const assertAccessCodesIssued = (
  recipients: { email: string; authOptions: unknown; signingStatus?: SigningStatus }[],
) => {
  const missing = recipients.find(
    (recipient) =>
      (recipient.signingStatus === undefined || recipient.signingStatus === SigningStatus.NOT_SIGNED) &&
      recipientRequiresAccessCode(recipient.authOptions) &&
      !getAccessCodeState(recipient.authOptions),
  );

  if (missing) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `Recipient ${missing.email} requires an access code, but none has been set.`,
    });
  }
};

/**
 * Direct links have no step where a code can be issued or entered, so a
 * template with a direct link cannot require one.
 */
export const assertNoAccessCodeOnDirectTemplate = (recipients: { authOptions: unknown }[]) => {
  if (recipients.some((recipient) => recipientRequiresAccessCode(recipient.authOptions))) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Direct links cannot be used with recipients that require an access code.',
    });
  }
};
