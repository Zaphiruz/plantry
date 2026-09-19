import type { PrismaClient } from '@prisma/client';
import type { Storage } from './services/storage.js';
import type { PushService } from './services/push.js';
import type { GithubClient } from './services/github.js';
export interface Deps {
  prisma: PrismaClient;
  frontendOrigin: string;
  storage?: Storage;
  push?: PushService;
  github?: GithubClient;
}
