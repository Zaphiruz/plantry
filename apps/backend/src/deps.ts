import type { PrismaClient } from '@prisma/client';
import type { Storage } from './services/storage.js';
export interface Deps {
  prisma: PrismaClient;
  frontendOrigin: string;
  storage?: Storage;
}
