import { describe, expect, it } from 'vitest';
import { PROTECTED_ENV_KEYS, filterSecrets } from '../env-filter.mjs';

describe('filterSecrets', () => {
  it('applies ordinary secrets', () => {
    expect(filterSecrets({ DATABASE_URL: 'postgres://x', SESSION_SECRET: 's' })).toEqual({
      applied: { DATABASE_URL: 'postgres://x', SESSION_SECRET: 's' },
      ignored: [],
    });
  });

  it('refuses to let a Vault key flip NODE_ENV or enable the dev bypass', () => {
    const { applied, ignored } = filterSecrets({
      NODE_ENV: 'development', AUTH_DEV_BYPASS: '1', DATABASE_URL: 'postgres://x',
    });
    expect(applied).toEqual({ DATABASE_URL: 'postgres://x' });
    expect(ignored).toEqual(['NODE_ENV', 'AUTH_DEV_BYPASS']);
  });

  it('refuses every protected key, and reports names only', () => {
    const bag = Object.fromEntries(PROTECTED_ENV_KEYS.map((k) => [k, 'evil']));
    const { applied, ignored } = filterSecrets(bag);
    expect(applied).toEqual({});
    expect(ignored.sort()).toEqual([...PROTECTED_ENV_KEYS].sort());
  });

  it('tolerates a missing secret bag', () => {
    expect(filterSecrets(undefined)).toEqual({ applied: {}, ignored: [] });
  });
});
