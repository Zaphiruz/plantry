import type { FastifyServerOptions } from 'fastify';

export interface SerializableRequest { method: string; url: string; ip?: string }
export interface SerializedRequest {
  method: string; url: string; remoteAddress: string | undefined;
  [key: string]: unknown;
}

/**
 * Pino request serializer that logs the request PATH only.
 *
 * The default Fastify serializer logs `req.url` verbatim, which puts secrets in
 * the log for URLs such as `/api/auth/callback?code=…&state=…`.
 */
export function serializeRequest(req: SerializableRequest): SerializedRequest {
  const url = req.url ?? '';
  const cut = url.search(/[?#]/);
  return {
    method: req.method,
    url: cut === -1 ? url : url.slice(0, cut),
    remoteAddress: req.ip,
  };
}

export const loggerOptions = {
  redact: { paths: ['req.headers.cookie', 'req.headers.authorization'], remove: true },
  serializers: { req: serializeRequest },
} satisfies FastifyServerOptions['logger'];
