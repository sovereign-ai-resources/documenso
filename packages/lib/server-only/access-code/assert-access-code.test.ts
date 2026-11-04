import { beforeAll, describe, expect, it } from 'vitest';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { createAccessCodeState, serializeAccessCodeCookie } from './access-code';
import {
  assertAccessCodesIssued,
  assertAccessCodeVerified,
  assertNoAccessCodeOnDirectTemplate,
  isAccessCodeSatisfied,
} from './assert-access-code';

const TOKEN = 'recipient-token-a';

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-value';
});

const verifiedHeaders = (state: Awaited<ReturnType<typeof createAccessCodeState>>) =>
  new Headers({ cookie: serializeAccessCodeCookie({ token: TOKEN, state }).split(';')[0] });

describe('access code guard', () => {
  it('lets a recipient without the option through', () => {
    expect(isAccessCodeSatisfied({ token: TOKEN, authOptions: { accessAuth: [], actionAuth: [] } }, undefined)).toBe(
      true,
    );
    expect(isAccessCodeSatisfied({ token: TOKEN, authOptions: null }, undefined)).toBe(true);
  });

  it('refuses a recipient that requires a code when the request has no verification cookie', async () => {
    const accessCode = await createAccessCodeState('k3x9p2');
    const recipient = { token: TOKEN, authOptions: { accessAuth: ['ACCESS_CODE'], actionAuth: [], accessCode } };

    expect(isAccessCodeSatisfied(recipient, new Headers())).toBe(false);

    try {
      assertAccessCodeVerified(recipient, new Headers());
      expect.unreachable();
    } catch (error) {
      expect(AppError.parseError(error).code).toBe(AppErrorCode.UNAUTHORIZED);
    }

    expect(() => assertAccessCodeVerified(recipient, verifiedHeaders(accessCode))).not.toThrow();
  });

  it('refuses a recipient that requires a code when none has been issued', () => {
    const recipient = { token: TOKEN, authOptions: { accessAuth: ['ACCESS_CODE'], actionAuth: [] } };

    expect(isAccessCodeSatisfied(recipient, new Headers({ cookie: 'unrelated=1' }))).toBe(false);
  });

  it('blocks sending while a required code has not been issued', async () => {
    const accessCode = await createAccessCodeState('k3x9p2');

    expect(() =>
      assertAccessCodesIssued([
        { email: 'a@example.com', authOptions: { accessAuth: ['ACCESS_CODE'], actionAuth: [] } },
      ]),
    ).toThrow(/requires an access code/);

    expect(() =>
      assertAccessCodesIssued([
        { email: 'a@example.com', authOptions: { accessAuth: ['ACCESS_CODE'], actionAuth: [], accessCode } },
        { email: 'b@example.com', authOptions: null },
      ]),
    ).not.toThrow();
  });

  it('does not count a recipient who has already signed as missing a code', () => {
    expect(() =>
      assertAccessCodesIssued([
        {
          email: 'a@example.com',
          signingStatus: 'SIGNED',
          authOptions: { accessAuth: ['ACCESS_CODE'], actionAuth: [] },
        },
      ]),
    ).not.toThrow();
  });

  it('refuses a direct link template whose recipients require a code', () => {
    expect(() =>
      assertNoAccessCodeOnDirectTemplate([
        { authOptions: { accessAuth: [], actionAuth: [] } },
        { authOptions: { accessAuth: ['ACCESS_CODE'], actionAuth: [] } },
      ]),
    ).toThrow(/access code/);

    expect(() =>
      assertNoAccessCodeOnDirectTemplate([
        { authOptions: { accessAuth: ['ACCOUNT'], actionAuth: [] } },
        { authOptions: null },
      ]),
    ).not.toThrow();
  });
});
