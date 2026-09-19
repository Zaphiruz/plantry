import type { Prisma } from '@prisma/client';
export const num = (d: Prisma.Decimal | number): number => Number(d);
export const numOrNull = (d: Prisma.Decimal | number | null | undefined): number | null => (d == null ? null : Number(d));
