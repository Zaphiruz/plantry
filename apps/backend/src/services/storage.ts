import {
  DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface Storage {
  presignPut(key: string, contentType: string, contentLength: number): Promise<string>;
  presignGet(key: string): Promise<string>;
  exists(key: string): Promise<boolean>;
  remove(keys: string[]): Promise<void>;
  list(prefix: string): Promise<{ key: string; lastModified: Date }[]>;
}
export const GET_TTL_SECONDS = 3600;
export const PUT_TTL_SECONDS = 900;
export const thumbKeyOf = (key: string): string => key.replace(/\.jpg$/, '-thumb.jpg');

export interface S3Config { endpoint: string; publicEndpoint: string; region: string; bucket: string; accessKey: string; secretKey: string }

/**
 * Two clients, same pattern as Dinner Club's apps/backend/src/s3.ts: presigned URLs must be signed against the
 * PUBLIC hostname the browser will use; head/list/delete go over the internal endpoint.
 */
export function createS3Storage(cfg: S3Config): Storage {
  const make = (endpoint: string) => new S3Client({
    endpoint, region: cfg.region, forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  });
  const internal = make(cfg.endpoint);
  const signer = make(cfg.publicEndpoint);
  const Bucket = cfg.bucket;

  return {
    presignPut: (Key, ContentType, ContentLength) =>
      getSignedUrl(signer, new PutObjectCommand({ Bucket, Key, ContentType, ContentLength }), { expiresIn: PUT_TTL_SECONDS }),
    presignGet: (Key) => getSignedUrl(signer, new GetObjectCommand({ Bucket, Key }), { expiresIn: GET_TTL_SECONDS }),
    async exists(Key) {
      try { await internal.send(new HeadObjectCommand({ Bucket, Key })); return true; }
      catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404) return false;
        throw err;
      }
    },
    async remove(keys) {
      if (keys.length === 0) return;
      for (let i = 0; i < keys.length; i += 1000) {
        await internal.send(new DeleteObjectsCommand({
          Bucket, Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
        }));
      }
    },
    async list(Prefix) {
      const out: { key: string; lastModified: Date }[] = [];
      let ContinuationToken: string | undefined;
      do {
        const page = await internal.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }));
        for (const o of page.Contents ?? []) if (o.Key && o.LastModified) out.push({ key: o.Key, lastModified: o.LastModified });
        ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (ContinuationToken);
      return out;
    },
  };
}
