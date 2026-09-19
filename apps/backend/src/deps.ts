import type { PrismaClient } from '@prisma/client';
export interface Deps {
  prisma: PrismaClient;
  frontendOrigin: string;
}
