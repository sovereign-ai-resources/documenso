import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { generateCookie } from 'hono/cookie';
import { parse as parseCookieHeader } from 'hono/utils/cookie';
import { z } from 'zod';

import { ACCESS_CODE_MAX_LENGTH, ACCESS_CODE_MIN_LENGTH } from '../../constants/access-code';
import { formatHostCookieName, shouldUseSecureCookies } from '../../constants/auth';
import { DocumentAuth, type TRecipientAuthOptions, ZRecipientAuthOptionsSchema } from '../../types/document-auth';
import { env } from '../../utils/env';

/**
 * Access code: a per-recipient secret the sender shares out of band. The
 * recipient must enter it before any recipient-token request is served.
 *
 * Only a salted hash is stored, inside the recipient's `authOptions` JSON. The
 * hash is keyed with the server secret, so a leaked hash cannot be guessed
 * offline. Rotating the server secret invalidates every issued code.
 *
 * A successful verification sets a short-lived HttpOnly cookie bound to the
 * recipient token and to this issue of the code. Nothing about verification is
 * ever stored on the recipient.
 */

export const ACCESS_CODE_COOKIE_TTL_SECONDS = 60 * 60;

const scryptAsync = promisify(scrypt) as (password: Buffer, salt: Buffer, keylen: number) => Promise<Buffer>;

export const ZRecipientAccessCodeSchema = z.object({
  salt: z.string().min(1),
  hash: z.string().min(1),
  failedAttempts: z.number().int().min(0),
  locked: z.boolean(),
});

export type TRecipientAccessCode = z.infer<typeof ZRecipientAccessCodeSchema>;

export type TAccessCodeWeakness = 'TOO_SHORT' | 'TOO_LONG' | 'REPEATED' | 'SEQUENTIAL';

const getServerSecret = () => {
  const secret = env('NEXTAUTH_SECRET');

  if (!secret) {
    throw new Error('NEXTAUTH_SECRET is not set');
  }

  return secret;
};

const deriveKey = (secret: string, purpose: 'hash' | 'cookie') =>
  createHmac('sha256', secret).update(`access-code:${purpose}`).digest();

export const normalizeAccessCode = (code: string) => code.trim();

const isSequential = (code: string) => {
  const chars = code.toLowerCase();

  const isRun = (step: number) => {
    for (let i = 1; i < chars.length; i++) {
      if (chars.charCodeAt(i) - chars.charCodeAt(i - 1) !== step) {
        return false;
      }
    }

    return true;
  };

  return isRun(1) || isRun(-1);
};

export const getAccessCodeWeakness = (rawCode: string): TAccessCodeWeakness | null => {
  const code = normalizeAccessCode(rawCode);

  if (code.length < ACCESS_CODE_MIN_LENGTH) {
    return 'TOO_SHORT';
  }

  if (code.length > ACCESS_CODE_MAX_LENGTH) {
    return 'TOO_LONG';
  }

  if (/^(.)\1+$/u.test(code)) {
    return 'REPEATED';
  }

  if (isSequential(code)) {
    return 'SEQUENTIAL';
  }

  return null;
};

const hashAccessCode = async (code: string, salt: string, secret: string) => {
  const keyed = createHmac('sha256', deriveKey(secret, 'hash')).update(normalizeAccessCode(code)).digest();

  const derived = await scryptAsync(keyed, Buffer.from(salt, 'base64url'), 32);

  return derived.toString('base64url');
};

export const createAccessCodeState = async (
  code: string,
  secret: string = getServerSecret(),
): Promise<TRecipientAccessCode> => {
  const salt = randomBytes(16).toString('base64url');

  return {
    salt,
    hash: await hashAccessCode(code, salt, secret),
    failedAttempts: 0,
    locked: false,
  };
};

const safeEqual = (a: string, b: string) => {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
};

export const isAccessCodeMatch = async (
  code: string,
  state: TRecipientAccessCode,
  secret: string = getServerSecret(),
) => {
  const hash = await hashAccessCode(code, state.salt, secret);

  return safeEqual(hash, state.hash);
};

export const getAccessCodeState = (authOptions: unknown): TRecipientAccessCode | null => {
  if (!authOptions || typeof authOptions !== 'object' || !('accessCode' in authOptions)) {
    return null;
  }

  const result = ZRecipientAccessCodeSchema.safeParse(authOptions.accessCode);

  return result.success ? result.data : null;
};

export const recipientRequiresAccessCode = (authOptions: unknown) =>
  ZRecipientAuthOptionsSchema.parse(authOptions).accessAuth.includes(DocumentAuth.ACCESS_CODE);

export const withoutAccessCodeMethod = <T extends string>(methods: T[]): T[] =>
  methods.filter((method) => method !== DocumentAuth.ACCESS_CODE);

export const withAccessCode = (
  next: TRecipientAuthOptions,
  previous: unknown,
): TRecipientAuthOptions & { accessCode?: TRecipientAccessCode } => {
  const accessCode = getAccessCodeState(previous);

  if (!accessCode || !next.accessAuth.includes(DocumentAuth.ACCESS_CODE)) {
    return next;
  }

  return { ...next, accessCode };
};

export const stripAccessCode = <T>(authOptions: T): T => {
  if (!authOptions || typeof authOptions !== 'object' || Array.isArray(authOptions) || !('accessCode' in authOptions)) {
    return authOptions;
  }

  const { accessCode: _accessCode, ...rest } = authOptions;

  return rest as T;
};

export const withoutStoredAccessCode = <T extends { authOptions: unknown }>(recipient: T): T => ({
  ...recipient,
  authOptions: stripAccessCode(recipient.authOptions),
});

export const withoutStoredAccessCodes = <T extends { recipients: { authOptions: unknown }[] }>(document: T): T => ({
  ...document,
  recipients: document.recipients.map(withoutStoredAccessCode),
});

export const getAccessCodeCookieName = (token: string) =>
  formatHostCookieName(`access_code_${createHash('sha256').update(token).digest('hex').slice(0, 24)}`);

const signCookie = (token: string, state: TRecipientAccessCode, expiresAt: number, secret: string) =>
  createHmac('sha256', deriveKey(secret, 'cookie')).update(`${token}\n${state.salt}\n${expiresAt}`).digest('base64url');

export const createAccessCodeCookieValue = ({
  token,
  state,
  now = Date.now(),
  secret = getServerSecret(),
}: {
  token: string;
  state: TRecipientAccessCode;
  now?: number;
  secret?: string;
}) => {
  const expiresAt = now + ACCESS_CODE_COOKIE_TTL_SECONDS * 1000;

  return `${expiresAt}.${signCookie(token, state, expiresAt, secret)}`;
};

export const isAccessCodeCookieValid = ({
  value,
  token,
  state,
  now = Date.now(),
  secret = getServerSecret(),
}: {
  value: string | undefined;
  token: string;
  state: TRecipientAccessCode;
  now?: number;
  secret?: string;
}) => {
  if (!value) {
    return false;
  }

  const [rawExpiresAt, signature, ...rest] = value.split('.');
  const expiresAt = Number(rawExpiresAt);

  if (rest.length > 0 || !signature || !Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    return false;
  }

  return safeEqual(signature, signCookie(token, state, expiresAt, secret));
};

/**
 * Cookie attributes mirror the embed session cookie: partitioned and
 * `SameSite=None` on HTTPS, so verification also works inside an embed iframe.
 */
export const serializeAccessCodeCookie = ({
  token,
  state,
  secret,
}: {
  token: string;
  state: TRecipientAccessCode;
  secret?: string;
}) => {
  const secure = shouldUseSecureCookies();

  return generateCookie(getAccessCodeCookieName(token), createAccessCodeCookieValue({ token, state, secret }), {
    httpOnly: true,
    path: '/',
    secure,
    sameSite: secure ? 'None' : 'Lax',
    partitioned: secure,
    maxAge: ACCESS_CODE_COOKIE_TTL_SECONDS,
  });
};

export type AccessCodeRecipient = {
  token: string;
  authOptions: unknown;
};

export const isAccessCodeVerifiedFromHeaders = (
  recipient: AccessCodeRecipient,
  headers: Headers | undefined,
  secret?: string,
) => {
  const state = getAccessCodeState(recipient.authOptions);
  const cookieHeader = headers?.get('cookie');

  if (!state || !cookieHeader) {
    return false;
  }

  const cookieName = getAccessCodeCookieName(recipient.token);
  const cookies = parseCookieHeader(cookieHeader, cookieName);

  return isAccessCodeCookieValid({ value: cookies[cookieName], token: recipient.token, state, secret });
};
