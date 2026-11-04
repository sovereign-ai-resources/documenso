import { describe, expect, it } from 'vitest';

import { ZRecipientAuthOptionsSchema } from '../../types/document-auth';
import { extractDocumentAuthMethods } from '../../utils/document-auth';
import {
  ACCESS_CODE_COOKIE_TTL_SECONDS,
  createAccessCodeCookieValue,
  createAccessCodeState,
  getAccessCodeCookieName,
  getAccessCodeState,
  getAccessCodeWeakness,
  isAccessCodeCookieValid,
  isAccessCodeMatch,
  isAccessCodeVerifiedFromHeaders,
  recipientRequiresAccessCode,
  serializeAccessCodeCookie,
  stripAccessCode,
  withAccessCode,
  withoutStoredAccessCode,
  withoutStoredAccessCodes,
} from './access-code';

const SECRET = 'test-secret-value';
const TOKEN = 'recipient-token-a';

describe('getAccessCodeWeakness', () => {
  it('refuses codes shorter than 6 characters', () => {
    expect(getAccessCodeWeakness('12a4b')).toBe('TOO_SHORT');
  });

  it('refuses codes that repeat a single character', () => {
    expect(getAccessCodeWeakness('111111')).toBe('REPEATED');
    expect(getAccessCodeWeakness('aaaaaaaa')).toBe('REPEATED');
  });

  it('refuses ascending and descending sequences', () => {
    expect(getAccessCodeWeakness('123456')).toBe('SEQUENTIAL');
    expect(getAccessCodeWeakness('654321')).toBe('SEQUENTIAL');
    expect(getAccessCodeWeakness('abcdef')).toBe('SEQUENTIAL');
    expect(getAccessCodeWeakness('FEDCBA')).toBe('SEQUENTIAL');
  });

  it('accepts a reasonable code', () => {
    expect(getAccessCodeWeakness('k3x9p2')).toBeNull();
    expect(getAccessCodeWeakness('124578')).toBeNull();
  });

  it('refuses codes longer than the maximum', () => {
    expect(getAccessCodeWeakness('x9'.repeat(40))).toBe('TOO_LONG');
  });
});

describe('access code hashing', () => {
  it('stores a salted hash, never the code, and matches only the right code', async () => {
    const state = await createAccessCodeState('k3x9p2', SECRET);

    expect(JSON.stringify(state)).not.toContain('k3x9p2');
    expect(state.failedAttempts).toBe(0);
    expect(state.locked).toBe(false);

    expect(await isAccessCodeMatch('k3x9p2', state, SECRET)).toBe(true);
    expect(await isAccessCodeMatch('k3x9p3', state, SECRET)).toBe(false);
  });

  it('uses a fresh salt each time the code is issued', async () => {
    const a = await createAccessCodeState('k3x9p2', SECRET);
    const b = await createAccessCodeState('k3x9p2', SECRET);

    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('does not match when the server secret differs', async () => {
    const state = await createAccessCodeState('k3x9p2', SECRET);

    expect(await isAccessCodeMatch('k3x9p2', state, 'another-secret')).toBe(false);
  });
});

describe('access code state in recipient auth options', () => {
  it('reads the stored state and whether the recipient requires a code', async () => {
    const accessCode = await createAccessCodeState('k3x9p2', SECRET);
    const authOptions = { accessAuth: ['ACCESS_CODE'], actionAuth: [], accessCode };

    expect(getAccessCodeState(authOptions)).toEqual(accessCode);
    expect(recipientRequiresAccessCode(authOptions)).toBe(true);
    expect(recipientRequiresAccessCode({ accessAuth: [], actionAuth: [] })).toBe(false);
    expect(recipientRequiresAccessCode(null)).toBe(false);
    expect(getAccessCodeState({ accessAuth: [], actionAuth: [] })).toBeNull();
  });

  it('is dropped by the upstream recipient auth options schema, so parsed output never carries it', async () => {
    const accessCode = await createAccessCodeState('k3x9p2', SECRET);
    const parsed = ZRecipientAuthOptionsSchema.parse({ accessAuth: ['ACCESS_CODE'], actionAuth: [], accessCode });

    expect(parsed).toEqual({ accessAuth: ['ACCESS_CODE'], actionAuth: [] });
  });

  it('survives a recipient update while the access code method stays selected', async () => {
    const accessCode = await createAccessCodeState('k3x9p2', SECRET);
    const previous = { accessAuth: ['ACCESS_CODE'], actionAuth: [], accessCode };

    expect(withAccessCode({ accessAuth: ['ACCESS_CODE'], actionAuth: ['ACCOUNT'] }, previous)).toEqual({
      accessAuth: ['ACCESS_CODE'],
      actionAuth: ['ACCOUNT'],
      accessCode,
    });
  });

  it('is removed when the access code method is no longer selected', async () => {
    const accessCode = await createAccessCodeState('k3x9p2', SECRET);
    const previous = { accessAuth: ['ACCESS_CODE'], actionAuth: [], accessCode };

    expect(withAccessCode({ accessAuth: [], actionAuth: [] }, previous)).toEqual({ accessAuth: [], actionAuth: [] });
  });

  it('strips the stored state from outbound payloads', async () => {
    const accessCode = await createAccessCodeState('k3x9p2', SECRET);

    expect(stripAccessCode({ accessAuth: ['ACCESS_CODE'], actionAuth: [], accessCode })).toEqual({
      accessAuth: ['ACCESS_CODE'],
      actionAuth: [],
    });
    expect(stripAccessCode(null)).toBeNull();
  });

  it('strips the stored state from recipient rows and their document before they reach the browser', async () => {
    const accessCode = await createAccessCodeState('k3x9p2', SECRET);
    const recipient = { id: 1, token: TOKEN, authOptions: { accessAuth: ['ACCESS_CODE'], actionAuth: [], accessCode } };

    expect(withoutStoredAccessCode(recipient)).toEqual({
      id: 1,
      token: TOKEN,
      authOptions: { accessAuth: ['ACCESS_CODE'], actionAuth: [] },
    });
    expect(JSON.stringify(withoutStoredAccessCodes({ title: 'x', recipients: [recipient] }))).not.toContain(
      accessCode.hash,
    );
  });
});

describe('access code verification cookie', () => {
  it('is valid only for the same recipient token and code issue, until it expires', async () => {
    const state = await createAccessCodeState('k3x9p2', SECRET);
    const reissued = await createAccessCodeState('k3x9p2', SECRET);
    const now = Date.now();

    const value = createAccessCodeCookieValue({ token: TOKEN, state, now, secret: SECRET });

    expect(isAccessCodeCookieValid({ value, token: TOKEN, state, now, secret: SECRET })).toBe(true);
    expect(isAccessCodeCookieValid({ value, token: 'recipient-token-b', state, now, secret: SECRET })).toBe(false);
    expect(isAccessCodeCookieValid({ value, token: TOKEN, state: reissued, now, secret: SECRET })).toBe(false);
    expect(
      isAccessCodeCookieValid({
        value,
        token: TOKEN,
        state,
        now: now + (ACCESS_CODE_COOKIE_TTL_SECONDS + 1) * 1000,
        secret: SECRET,
      }),
    ).toBe(false);
    expect(isAccessCodeCookieValid({ value: `${value}0`, token: TOKEN, state, now, secret: SECRET })).toBe(false);
    expect(isAccessCodeCookieValid({ value: 'garbage', token: TOKEN, state, now, secret: SECRET })).toBe(false);
  });

  it('uses a different cookie name per recipient token', () => {
    expect(getAccessCodeCookieName(TOKEN)).not.toBe(getAccessCodeCookieName('recipient-token-b'));
    expect(getAccessCodeCookieName(TOKEN)).not.toContain(TOKEN);
  });

  it('is HttpOnly and is read back from request headers', async () => {
    const state = await createAccessCodeState('k3x9p2', SECRET);
    const authOptions = { accessAuth: ['ACCESS_CODE'], actionAuth: [], accessCode: state };

    const setCookie = serializeAccessCodeCookie({ token: TOKEN, state, secret: SECRET });

    expect(setCookie).toContain('HttpOnly');

    const cookiePair = setCookie.split(';')[0];
    const withCookie = new Headers({ cookie: cookiePair });
    const otherBrowser = new Headers();

    expect(isAccessCodeVerifiedFromHeaders({ token: TOKEN, authOptions }, withCookie, SECRET)).toBe(true);
    expect(isAccessCodeVerifiedFromHeaders({ token: TOKEN, authOptions }, otherBrowser, SECRET)).toBe(false);
    expect(isAccessCodeVerifiedFromHeaders({ token: 'recipient-token-b', authOptions }, withCookie, SECRET)).toBe(
      false,
    );
  });
});

describe('derived access methods with an access code', () => {
  it('keeps the document access methods when a recipient only adds an access code', () => {
    const { derivedRecipientAccessAuth } = extractDocumentAuthMethods({
      documentAuth: { globalAccessAuth: ['ACCOUNT'], globalActionAuth: [] },
      recipientAuth: { accessAuth: ['ACCESS_CODE'], actionAuth: [] },
    });

    expect(derivedRecipientAccessAuth).toEqual(['ACCOUNT', 'ACCESS_CODE']);
  });

  it('keeps the recipient access methods when the recipient sets its own', () => {
    const { derivedRecipientAccessAuth } = extractDocumentAuthMethods({
      documentAuth: { globalAccessAuth: ['ACCOUNT'], globalActionAuth: [] },
      recipientAuth: { accessAuth: ['TWO_FACTOR_AUTH', 'ACCESS_CODE'], actionAuth: [] },
    });

    expect(derivedRecipientAccessAuth).toEqual(['TWO_FACTOR_AUTH', 'ACCESS_CODE']);
  });
});
