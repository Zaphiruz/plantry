import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = {
  DATABASE_URL: 'postgres://x', SESSION_SECRET: 's', FRONTEND_ORIGIN: 'https://plantry.wispy-nook.casa',
  AUTHENTIK_ISSUER_URL: 'https://a/', AUTHENTIK_CLIENT_ID: 'id', AUTHENTIK_CLIENT_SECRET: 'sec', AUTHENTIK_REDIRECT_URI: 'https://p/cb',
};

describe('config', () => {
  it('push and photos are optional and all-or-nothing', () => {
    const c = loadConfig(base);
    expect(c.vapid).toBeNull(); expect(c.s3).toBeNull(); expect(c.adminGroup).toBe('plantry-admins');
    const full = loadConfig({ ...base, VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k', VAPID_SUBJECT: 'mailto:a@b.c',
      S3_ENDPOINT: 'http://m', S3_PUBLIC_ENDPOINT: 'https://m', S3_BUCKET: 'b', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 's' });
    expect(full.vapid?.publicKey).toBe('p');
    expect(full.s3).toMatchObject({ bucket: 'b', region: 'us-east-1' });
  });
  it('github feedback config is optional', () => {
    expect(loadConfig(base).github).toBeNull();
    expect(loadConfig({ ...base, GITHUB_FEEDBACK_TOKEN: 't', GITHUB_FEEDBACK_REPO: 'Zaphiruz/plantry' }).github)
      .toEqual({ token: 't', owner: 'Zaphiruz', repo: 'plantry' });
  });
  it('throws on missing required vars', () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: '' })).toThrow(/SESSION_SECRET/);
  });
  it('refuses the dev bypass in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', AUTH_DEV_BYPASS: '1' })).toThrow(/AUTH_DEV_BYPASS/);
    expect(loadConfig({ ...base, AUTH_DEV_BYPASS: '1' }).devBypass).toBe(true);
  });
});
