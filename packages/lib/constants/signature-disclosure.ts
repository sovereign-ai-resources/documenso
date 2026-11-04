import { env } from '../utils/env';

const BUILT_IN_SIGNATURE_DISCLOSURE_PATH = '/articles/signature-disclosure';

/**
 * Where the signing page's "signature disclosure" link points.
 *
 * Set `NEXT_PUBLIC_SIGNATURE_DISCLOSURE_URL` to serve your own electronic
 * records and signature disclosure; unset, the built-in page is used.
 */
export const SIGNATURE_DISCLOSURE_URL = () =>
  env('NEXT_PUBLIC_SIGNATURE_DISCLOSURE_URL')?.trim() || BUILT_IN_SIGNATURE_DISCLOSURE_PATH;
