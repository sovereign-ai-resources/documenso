import { afterEach, describe, expect, it, vi } from 'vitest';

import { SOURCE_OFFER } from './source-offer';

describe('SOURCE_OFFER', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('links the repository tree at the deployed commit', () => {
    vi.stubEnv('NEXT_PUBLIC_SOURCE_REPOSITORY_URL', 'https://github.com/example/app/');
    vi.stubEnv('NEXT_PUBLIC_SOURCE_COMMIT', 'abc1234');

    expect(SOURCE_OFFER()).toEqual({
      repositoryUrl: 'https://github.com/example/app',
      commit: 'abc1234',
      treeUrl: 'https://github.com/example/app/tree/abc1234',
    });
  });

  it('offers nothing when the commit is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_SOURCE_REPOSITORY_URL', 'https://github.com/example/app');
    vi.stubEnv('NEXT_PUBLIC_SOURCE_COMMIT', '');

    expect(SOURCE_OFFER()).toBeNull();
  });

  it('offers nothing when the repository is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_SOURCE_REPOSITORY_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_SOURCE_COMMIT', 'abc1234');

    expect(SOURCE_OFFER()).toBeNull();
  });
});
