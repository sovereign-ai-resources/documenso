import { env } from '../utils/env';

export const ACCESS_CODE_MIN_LENGTH = 6;
export const ACCESS_CODE_MAX_LENGTH = 64;
export const ACCESS_CODE_MAX_FAILED_ATTEMPTS = 5;

/**
 * Whether senders can require an access code. Off by default. Enforcement does
 * not depend on it: a recipient that already requires a code keeps requiring it.
 */
export const IS_ACCESS_CODE_ENABLED = () => env('NEXT_PUBLIC_FEATURE_ACCESS_CODE') === 'true';
