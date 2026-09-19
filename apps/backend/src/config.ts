import type { PushConfig } from './services/push.js';
import type { S3Config } from './services/storage.js';

export interface AppConfig {
  port: number; nodeEnv: string; databaseUrl: string; frontendOrigin: string;
  sessionSecret: string; cookieSecure: boolean; adminGroup: string; devBypass: boolean;
  oidc: { issuer: string; clientId: string; clientSecret: string; redirectUri: string };
  vapid: PushConfig | null;
  s3: S3Config | null;
}
type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): AppConfig {
  const required = (name: string): string => {
    const v = env[name];
    if (!v) throw new Error(`Missing required environment variable: ${name}`);
    return v;
  };
  const nodeEnv = env['NODE_ENV'] ?? 'development';
  const devBypass = env['AUTH_DEV_BYPASS'] === '1';
  if (devBypass && nodeEnv === 'production') throw new Error('AUTH_DEV_BYPASS must not be set in production');

  const vapid = env['VAPID_PUBLIC_KEY'] && env['VAPID_PRIVATE_KEY']
    ? { publicKey: env['VAPID_PUBLIC_KEY'], privateKey: env['VAPID_PRIVATE_KEY'], subject: env['VAPID_SUBJECT'] ?? 'mailto:noreply@wispy-nook.casa' }
    : null;
  const s3 = env['S3_ENDPOINT'] && env['S3_BUCKET'] && env['S3_ACCESS_KEY'] && env['S3_SECRET_KEY']
    ? { endpoint: env['S3_ENDPOINT'], publicEndpoint: env['S3_PUBLIC_ENDPOINT'] ?? env['S3_ENDPOINT'], region: env['S3_REGION'] ?? 'us-east-1',
        bucket: env['S3_BUCKET'], accessKey: env['S3_ACCESS_KEY'], secretKey: env['S3_SECRET_KEY'] }
    : null;

  return {
    port: Number(env['PORT'] ?? '3000'), nodeEnv,
    databaseUrl: required('DATABASE_URL'),
    frontendOrigin: required('FRONTEND_ORIGIN'),
    sessionSecret: required('SESSION_SECRET'),
    cookieSecure: (env['SESSION_COOKIE_SECURE'] ?? (nodeEnv === 'production' ? 'true' : 'false')) === 'true',
    adminGroup: env['AUTHENTIK_ADMIN_GROUP'] ?? 'plantry-admins',
    devBypass,
    oidc: {
      issuer: required('AUTHENTIK_ISSUER_URL'), clientId: required('AUTHENTIK_CLIENT_ID'),
      clientSecret: required('AUTHENTIK_CLIENT_SECRET'), redirectUri: required('AUTHENTIK_REDIRECT_URI'),
    },
    vapid, s3,
  };
}
