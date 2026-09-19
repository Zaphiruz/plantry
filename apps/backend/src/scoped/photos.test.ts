import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);
beforeEach(() => ctx.storage.objects.clear());

const OK = { mimeType: 'image/jpeg', sizeBytes: 120_000, thumbSizeBytes: 9_000 };
const thumb = (k: string) => k.replace(/\.jpg$/, '-thumb.jpg');

describe('item photos', () => {
  it('upload-url → finalize sets image_ref; item responses carry presigned GET urls', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const item = await ctx.item(hid);
    const up = (await ctx.call(u, 'POST', `${base}/items/${item.id}/photo/upload-url`, OK)).body.data;
    expect(up.key).toMatch(new RegExp(`^h/${hid}/items/${item.id}/[0-9a-f-]{36}\\.jpg$`));
    expect(up.uploadUrl).toContain(up.key);
    expect(up.thumbUploadUrl).toContain(thumb(up.key));

    const early = await ctx.call(u, 'POST', `${base}/items/${item.id}/photo/finalize`, { key: up.key });
    expect(early.status).toBe(400); // objects not uploaded yet

    ctx.storage.put(up.key); ctx.storage.put(thumb(up.key));
    const fin = await ctx.call(u, 'POST', `${base}/items/${item.id}/photo/finalize`, { key: up.key });
    expect(fin.status).toBe(200);
    expect(fin.body.data.imageUrl).toBe(`https://fake-s3/${up.key}?op=get`);
    expect(fin.body.data.thumbUrl).toBe(`https://fake-s3/${thumb(up.key)}?op=get`);
    expect(fin.body.data.imageUrlsExpireAt).not.toBeNull();
  });

  it('replacing deletes the previous pair; DELETE clears and removes', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const item = await ctx.item(hid);
    const put = async () => {
      const up = (await ctx.call(u, 'POST', `${base}/items/${item.id}/photo/upload-url`, OK)).body.data;
      ctx.storage.put(up.key); ctx.storage.put(thumb(up.key));
      await ctx.call(u, 'POST', `${base}/items/${item.id}/photo/finalize`, { key: up.key });
      return up.key as string;
    };
    const first = await put(); const second = await put();
    expect(ctx.storage.objects.has(first)).toBe(false);
    expect(ctx.storage.objects.has(second)).toBe(true);
    expect((await ctx.call(u, 'DELETE', `${base}/items/${item.id}/photo`)).status).toBe(204);
    expect(ctx.storage.objects.size).toBe(0);
    expect((await ctx.call(u, 'GET', `${base}/items/${item.id}`)).body.data.imageUrl).toBeNull();
  });

  it('finalize refuses keys that belong to another item', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const a = await ctx.item(hid); const b = await ctx.item(hid);
    const up = (await ctx.call(u, 'POST', `${base}/items/${a.id}/photo/upload-url`, OK)).body.data;
    ctx.storage.put(up.key); ctx.storage.put(thumb(up.key));
    expect((await ctx.call(u, 'POST', `${base}/items/${b.id}/photo/finalize`, { key: up.key })).status).toBe(400);
  });

  it('deleting the household (last member leaves) removes its photos', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const item = await ctx.item(hid);
    const up = (await ctx.call(u, 'POST', `${base}/items/${item.id}/photo/upload-url`, OK)).body.data;
    ctx.storage.put(up.key); ctx.storage.put(thumb(up.key));
    await ctx.call(u, 'POST', `${base}/items/${item.id}/photo/finalize`, { key: up.key });
    await ctx.call(u, 'DELETE', `${base}/members/me`);
    expect(ctx.storage.objects.size).toBe(0);
  });

  it('is 503 photos_disabled without storage, and /me says so', async () => {
    const bare = await createTestApp({ storage: false });
    try {
      const u = await bare.user(); const hid = await bare.household(u); const item = await bare.item(hid);
      const r = await bare.call(u, 'POST', `/api/households/${hid}/items/${item.id}/photo/upload-url`, OK);
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe('photos_disabled');
      expect((await bare.call(u, 'GET', '/api/me')).body.data.photosEnabled).toBe(false);
    } finally { await bare.close(); }
  });
});
