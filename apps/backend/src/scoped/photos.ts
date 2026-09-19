import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { photoFinalizeSchema, photoUploadSchema, type PhotoUploadDto } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { AppError, parse } from '../errors.js';
import { loadItem, serializeItem } from '../services/items.js';
import { thumbKeyOf, type Storage } from '../services/storage.js';

const disabled = () => new AppError(503, 'photos_disabled', 'Photo storage is not configured');

export function registerPhotoRoutes(s: FastifyInstance, deps: Deps): void {
  const requireStorage = (): Storage => { if (!deps.storage) throw disabled(); return deps.storage; };
  const prefixFor = (hid: string, itemId: string) => `h/${hid}/items/${itemId}/`;

  // Always load the item FIRST so scoping (404) wins over configuration (503).
  s.post<{ Params: { id: string } }>('/items/:id/photo/upload-url', async (req) => {
    const item = await loadItem(deps, req.household!.id, req.params.id);
    const storage = requireStorage();
    const b = parse(photoUploadSchema, req.body);
    const key = `${prefixFor(req.household!.id, item.id)}${randomUUID()}.jpg`;
    const data: PhotoUploadDto = {
      key,
      uploadUrl: await storage.presignPut(key, b.mimeType, b.sizeBytes),
      thumbUploadUrl: await storage.presignPut(thumbKeyOf(key), b.mimeType, b.thumbSizeBytes),
    };
    return { data };
  });

  s.post<{ Params: { id: string } }>('/items/:id/photo/finalize', async (req) => {
    const hid = req.household!.id;
    const item = await loadItem(deps, hid, req.params.id);
    const storage = requireStorage();
    const { key } = parse(photoFinalizeSchema, req.body);
    const prefix = prefixFor(hid, item.id);
    if (!key.startsWith(prefix) || !/^[0-9a-f-]{36}\.jpg$/.test(key.slice(prefix.length))) {
      throw new AppError(400, 'validation_error', 'Key does not belong to this item');
    }
    const [full, small] = await Promise.all([storage.exists(key), storage.exists(thumbKeyOf(key))]);
    if (!full || !small) throw new AppError(400, 'validation_error', 'Upload both objects before finalizing');
    await deps.prisma.item.update({ where: { id: item.id }, data: { imageRef: key } });
    if (item.imageRef && item.imageRef !== key) {
      await storage.remove([item.imageRef, thumbKeyOf(item.imageRef)]).catch((err) => req.log.error({ err }, 'old photo cleanup failed'));
    }
    return { data: await serializeItem(await loadItem(deps, hid, item.id), storage) };
  });

  s.delete<{ Params: { id: string } }>('/items/:id/photo', async (req, reply) => {
    const item = await loadItem(deps, req.household!.id, req.params.id);
    const storage = requireStorage();
    if (item.imageRef) {
      await deps.prisma.item.update({ where: { id: item.id }, data: { imageRef: null } });
      await storage.remove([item.imageRef, thumbKeyOf(item.imageRef)]);
    }
    return reply.code(204).send();
  });
}
