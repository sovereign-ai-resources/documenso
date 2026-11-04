import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSingleOrganisationId, isSingleOrganisationMode } from './single-organisation';

const FLAG = 'NEXT_PRIVATE_SINGLE_ORGANISATION_ID';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isSingleOrganisationMode', () => {
  it('is off when the variable is unset or blank', () => {
    vi.stubEnv(FLAG, '');
    expect(isSingleOrganisationMode()).toBe(false);

    vi.stubEnv(FLAG, '   ');
    expect(isSingleOrganisationMode()).toBe(false);
  });

  it('is on, with surrounding whitespace trimmed, when the variable holds an organisation id', () => {
    vi.stubEnv(FLAG, '  org_configured ');

    expect(isSingleOrganisationMode()).toBe(true);
    expect(getSingleOrganisationId()).toBe('org_configured');
  });
});
