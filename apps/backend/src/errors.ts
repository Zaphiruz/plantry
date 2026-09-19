import type { z } from 'zod';
import type { ErrorCode } from '@plantry/shared';

export class AppError extends Error {
  constructor(public status: number, public code: ErrorCode, message: string, public details?: unknown) {
    super(message);
  }
}
export const notFound = (message = 'Not found') => new AppError(404, 'not_found', message);
export const forbidden = (message = 'Forbidden') => new AppError(403, 'forbidden', message);

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new AppError(400, 'validation_error', 'Invalid request', r.error.flatten());
  return r.data;
}
