import type { PrismaClient } from '@prisma/client';
import type { Storage } from './services/storage.js';
import type { PushService } from './services/push.js';
export interface Deps {
  prisma: PrismaClient;
  frontendOrigin: string;
  storage?: Storage;
  push?: PushService;
}
