import { PrismaClient } from '@prisma/client';
import { buildApp } from './app.js';
import { createOidcClient } from './auth/oidc.js';
import { loadConfig } from './config.js';
import { loggerOptions } from './logging.js';
import { startDailySchedule } from './jobs/daily.js';
import { createPushService } from './services/push.js';
import { createS3Storage } from './services/storage.js';
import { createGithubClient } from './services/github.js';

const config = loadConfig();
const prisma = new PrismaClient();
const storage = config.s3 ? createS3Storage(config.s3) : undefined;
const push = config.vapid
  ? createPushService(prisma, config.vapid, (err, msg) => console.error(JSON.stringify({ level: 'error', msg, err: String(err) })))
  : undefined;
const github = config.github ? createGithubClient(config.github) : undefined;

const app = await buildApp({
  logger: loggerOptions,
  trustProxyHops: config.trustProxyHops,
  prisma,
  frontendOrigin: config.frontendOrigin,
  sessionSecret: config.sessionSecret,
  cookieSecure: config.cookieSecure,
  adminGroup: config.adminGroup,
  devBypass: config.devBypass,
  oidcClient: createOidcClient(config.oidc),
  ...(storage ? { storage } : {}),
  ...(push ? { push } : {}),
  ...(github ? { github } : {}),
});

const schedule = startDailySchedule(
  { prisma, frontendOrigin: config.frontendOrigin, ...(storage ? { storage } : {}), ...(push ? { push } : {}) },
  app.log,
);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    schedule.stop();
    void app.close().then(() => prisma.$disconnect()).then(() => process.exit(0));
  });
}

await app.listen({ host: '0.0.0.0', port: config.port });
app.log.info({ photos: !!storage, push: !!push, feedback: !!github, devBypass: config.devBypass }, 'plantry backend ready');
