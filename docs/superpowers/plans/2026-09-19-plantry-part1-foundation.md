# Plantry Plan — Part 1: Foundation (Tasks 1–5)

Index + Global Constraints: [2026-09-19-plantry.md](2026-09-19-plantry.md). Reference implementation for patterns: `D:\code\Velvet Scoop\website-v2`.

---

### Task 1: Monorepo scaffold + shared contract package

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.dockerignore`, `.env.example`, `docker-compose.yml`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/index.ts`, `constants.ts`, `schemas.ts`, `types.ts`
- Test: `packages/shared/src/schemas.test.ts`

**Interfaces:**
- Produces: everything exported from `@plantry/shared` (names below are used verbatim by every later task).

- [ ] **Step 1: Root files**

`package.json`:
```json
{
  "name": "plantry",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@10.33.2",
  "scripts": {
    "dev": "pnpm -r --parallel --filter=./apps/* dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "prisma:migrate": "pnpm --filter @plantry/backend prisma migrate dev",
    "prisma:generate": "pnpm --filter @plantry/backend prisma generate"
  },
  "devDependencies": { "prettier": "^3.3.3", "typescript": "^5.6.3" },
  "engines": { "node": ">=20.10.0" },
  "pnpm": { "onlyBuiltDependencies": ["@prisma/client", "@prisma/engines", "prisma", "esbuild"] }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["ES2022"], "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "noImplicitOverride": true, "noUncheckedIndexedAccess": true,
    "esModuleInterop": true, "forceConsistentCasingInFileNames": true, "skipLibCheck": true,
    "resolveJsonModule": true, "isolatedModules": true, "noEmit": true
  }
}
```

`.gitignore`:
```
node_modules
dist
dev-dist
.env
*.tsbuildinfo
playwright-report
test-results
vault-token
```

`.dockerignore`:
```
**/node_modules
**/dist
.git
.env
docs
```

`.env.example`:
```
DATABASE_URL=postgres://plantry:plantry@localhost:5434/plantry
SESSION_SECRET=dev-only-secret-change-me
SESSION_COOKIE_SECURE=false
FRONTEND_ORIGIN=http://localhost:5173
AUTH_DEV_BYPASS=1
AUTHENTIK_ISSUER_URL=https://authentik.wispy-nook.casa/application/o/plantry/
AUTHENTIK_CLIENT_ID=
AUTHENTIK_CLIENT_SECRET=
AUTHENTIK_REDIRECT_URI=http://localhost:5173/api/auth/callback
AUTHENTIK_ADMIN_GROUP=plantry-admins
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:noreply@wispy-nook.casa
S3_ENDPOINT=http://localhost:9100
S3_PUBLIC_ENDPOINT=http://localhost:9100
S3_REGION=us-east-1
S3_BUCKET=plantry-media
S3_ACCESS_KEY=plantry
S3_SECRET_KEY=plantry-secret
```

`docker-compose.yml` (dev only):
```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: plantry
      POSTGRES_PASSWORD: plantry
      POSTGRES_DB: plantry
    ports: ["5434:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: plantry
      MINIO_ROOT_PASSWORD: plantry-secret
    ports: ["9100:9000", "9101:9001"]
    volumes: [minio-data:/data]
  minio-setup:
    image: minio/mc:latest
    depends_on: [minio]
    entrypoint: >
      /bin/sh -c "
      sleep 3;
      mc alias set local http://minio:9000 plantry plantry-secret;
      mc mb --ignore-existing local/plantry-media;
      exit 0;
      "
volumes:
  pgdata:
  minio-data:
```

- [ ] **Step 2: Shared package config**

`packages/shared/package.json`:
```json
{
  "name": "@plantry/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "zod": "^3.23.8" },
  "devDependencies": { "typescript": "^5.6.3", "vitest": "^2.1.5" }
}
```

`packages/shared/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src/**/*.ts"] }
```

`packages/shared/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
```

- [ ] **Step 3: Write the failing schema test**

`packages/shared/src/schemas.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  RATE_WINDOWS, windowDays, rateWindowSchema, restockSchema, consumeSchema,
  itemCreateSchema, itemUpdateSchema, shoppingAddSchema, photoUploadSchema,
} from './index.js';

describe('rate windows', () => {
  it('is the fixed enum', () => {
    expect(RATE_WINDOWS).toEqual(['30d', '60d', '90d', '183d', '365d']);
    expect(windowDays('183d')).toBe(183);
  });
  it('rejects anything else', () => {
    expect(rateWindowSchema.safeParse('7d').success).toBe(false);
    expect(rateWindowSchema.safeParse('90d').success).toBe(true);
  });
});

describe('quantities', () => {
  it('rejects zero, negatives and >3 decimals', () => {
    expect(restockSchema.safeParse({ quantity: 0 }).success).toBe(false);
    expect(restockSchema.safeParse({ quantity: -1 }).success).toBe(false);
    expect(restockSchema.safeParse({ quantity: 1.2345 }).success).toBe(false);
    expect(restockSchema.safeParse({ quantity: 1.234 }).success).toBe(true);
  });
  it('consume defaults to 1', () => {
    expect(consumeSchema.parse({}).quantity).toBe(1);
  });
});

describe('items', () => {
  const unitId = '7b0f7a3c-8a53-4bd1-9d0e-3f0a3d1f6a11';
  it('applies create defaults', () => {
    const v = itemCreateSchema.parse({ name: ' Cat food ', unitId });
    expect(v).toMatchObject({
      name: 'Cat food', renotifyAfterDays: 7, defaultRestockQty: 1,
      autoDeductPeriodDays: 1, autoDeductPaused: false, currentCount: 0, minStock: 0,
    });
  });
  it('update applies NO defaults', () => {
    expect(itemUpdateSchema.parse({ name: 'x' })).toEqual({ name: 'x' });
  });
  it('update rejects currentCount (use adjust)', () => {
    expect(itemUpdateSchema.safeParse({ currentCount: 5 }).success).toBe(false);
  });
});

describe('shopping add', () => {
  it('accepts item-linked or free-text, not both', () => {
    const itemId = '7b0f7a3c-8a53-4bd1-9d0e-3f0a3d1f6a11';
    expect(shoppingAddSchema.safeParse({ itemId }).success).toBe(true);
    expect(shoppingAddSchema.safeParse({ name: 'candles' }).success).toBe(true);
    expect(shoppingAddSchema.safeParse({ itemId, name: 'x' }).success).toBe(false);
    expect(shoppingAddSchema.safeParse({}).success).toBe(false);
  });
});

describe('photo upload', () => {
  it('enforces jpeg and size caps', () => {
    const ok = { mimeType: 'image/jpeg', sizeBytes: 5 * 1024 * 1024, thumbSizeBytes: 200 * 1024 };
    expect(photoUploadSchema.safeParse(ok).success).toBe(true);
    expect(photoUploadSchema.safeParse({ ...ok, mimeType: 'image/png' }).success).toBe(false);
    expect(photoUploadSchema.safeParse({ ...ok, sizeBytes: ok.sizeBytes + 1 }).success).toBe(false);
  });
});
```

- [ ] **Step 4: Run it — expect failure**

Run: `pnpm install && pnpm --filter @plantry/shared test`
Expected: FAIL — cannot resolve `./index.js`.

- [ ] **Step 5: Implement the shared package**

`packages/shared/src/constants.ts`:
```ts
export const RATE_WINDOWS = ['30d', '60d', '90d', '183d', '365d'] as const;
export type RateWindow = (typeof RATE_WINDOWS)[number];
export function windowDays(w: RateWindow): number {
  return Number(w.slice(0, -1));
}

export const EVENT_TYPES = ['restock', 'consume', 'adjust', 'auto_deduct'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ERROR_CODES = [
  'validation_error', 'archive_first', 'unauthorized', 'forbidden', 'not_found', 'last_owner',
  'unit_in_use', 'barcode_conflict', 'already_on_list', 'undo_expired', 'invite_invalid',
  'photos_disabled', 'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const UNDO_WINDOW_MS = 5 * 60 * 1000;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const THUMB_MAX_BYTES = 200 * 1024;
export const PHOTO_MAX_EDGE = 1600;
export const THUMB_MAX_EDGE = 256;
```

`packages/shared/src/schemas.ts`:
```ts
import { z } from 'zod';
import { PHOTO_MAX_BYTES, RATE_WINDOWS, THUMB_MAX_BYTES } from './constants.js';

const threeDp = (n: number) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;
const MAX = 999_999_999;
export const qtySchema = z.number().finite().positive().max(MAX).refine(threeDp, 'max 3 decimal places');
export const countSchema = z.number().finite().min(-MAX).max(MAX).refine(threeDp, 'max 3 decimal places');
const nonNegSchema = z.number().finite().min(0).max(MAX).refine(threeDp, 'max 3 decimal places');
const nameSchema = z.string().trim().min(1).max(120);
const noteSchema = z.string().trim().max(500).nullish();
const uuid = z.string().uuid();

export const householdNameSchema = z.object({ name: nameSchema }).strict();
export const memberRoleSchema = z.object({ role: z.enum(['owner', 'member']) }).strict();

export const storeCreateSchema = z.object({ name: nameSchema, notes: noteSchema }).strict();
export const storeUpdateSchema = storeCreateSchema.partial();

export const unitCreateSchema = z.object({
  name: z.string().trim().min(1).max(40),
  pluralName: z.string().trim().min(1).max(40).nullish(),
  abbreviation: z.string().trim().min(1).max(12).nullish(),
}).strict();
export const unitUpdateSchema = unitCreateSchema.partial();

const itemFields = {
  name: nameSchema,
  description: z.string().trim().max(1000).nullish(),
  category: z.string().trim().min(1).max(60).nullish(),
  unitId: uuid,
  preferredStoreId: uuid.nullish(),
  barcode: z.string().trim().min(1).max(64).nullish(),
  renotifyAfterDays: z.number().int().min(1).max(365),
  defaultRestockQty: qtySchema,
  autoDeductQty: qtySchema.nullish(),
  autoDeductPeriodDays: z.number().int().min(1).max(3650),
  autoDeductPaused: z.boolean(),
  minStock: nonNegSchema,
};
export const itemCreateSchema = z.object({
  ...itemFields,
  renotifyAfterDays: itemFields.renotifyAfterDays.default(7),
  defaultRestockQty: itemFields.defaultRestockQty.default(1),
  autoDeductPeriodDays: itemFields.autoDeductPeriodDays.default(1),
  autoDeductPaused: itemFields.autoDeductPaused.default(false),
  minStock: itemFields.minStock.default(0),
  currentCount: countSchema.default(0),
}).strict();
export const itemUpdateSchema = z.object(itemFields).partial().strict();

export const restockSchema = z.object({ quantity: qtySchema, note: noteSchema }).strict();
export const consumeSchema = z.object({ quantity: qtySchema.default(1), note: noteSchema }).strict();
export const adjustSchema = z.object({ newCount: countSchema, note: noteSchema }).strict();

export const rateWindowSchema = z.enum(RATE_WINDOWS);

export const consolidateSchema = z.object({
  sourceId: uuid,
  keepMinStockFrom: z.enum(['target', 'source']).default('target'),
}).strict();

export const shoppingAddSchema = z.union([
  z.object({ itemId: uuid, quantity: qtySchema.nullish() }).strict(),
  z.object({ name: nameSchema, storeId: uuid.nullish(), quantity: qtySchema.nullish() }).strict(),
]);
export const shoppingPatchSchema = z.object({ checkedOff: z.boolean() }).strict();
export const purchaseSchema = z.object({ quantity: qtySchema.optional() }).strict();

export const pushSubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(200) }),
}).strict();
export const pushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(2000) }).strict();

export const photoUploadSchema = z.object({
  mimeType: z.literal('image/jpeg'),
  sizeBytes: z.number().int().min(1).max(PHOTO_MAX_BYTES),
  thumbSizeBytes: z.number().int().min(1).max(THUMB_MAX_BYTES),
}).strict();
export const photoFinalizeSchema = z.object({ key: z.string().min(1).max(300) }).strict();

export type ItemCreateInput = z.infer<typeof itemCreateSchema>;
export type ItemUpdateInput = z.infer<typeof itemUpdateSchema>;
export type ShoppingAddInput = z.infer<typeof shoppingAddSchema>;
```

`packages/shared/src/types.ts`:
```ts
import type { EventType, RateWindow } from './constants.js';

export type MemberRole = 'owner' | 'member';
export interface UserDto { sub: string; name: string; email: string; isAdmin: boolean }
export interface HouseholdSummary { id: string; name: string; role: MemberRole }
export interface MeDto { user: UserDto; households: HouseholdSummary[]; photosEnabled: boolean; pushEnabled: boolean }
export interface MemberDto { sub: string; name: string; email: string; role: MemberRole; joinedAt: string }
export interface InviteDto { url: string; expiresAt: string }
export interface StoreDto { id: string; name: string; notes: string | null }
export interface UnitDto { id: string; name: string; pluralName: string | null; abbreviation: string | null; global: boolean }

export interface ItemDto {
  id: string; name: string; description: string | null; category: string | null;
  unit: UnitDto; preferredStoreId: string | null; barcode: string | null;
  renotifyAfterDays: number; defaultRestockQty: number;
  autoDeductQty: number | null; autoDeductPeriodDays: number; autoDeductPaused: boolean;
  archivedAt: string | null;
  currentCount: number; minStock: number; low: boolean;
  lastRestockedAt: string | null;
  nextTripRowId: string | null;
  imageUrl: string | null; thumbUrl: string | null; imageUrlsExpireAt: string | null;
}

export interface EventDto {
  id: string; itemId: string; eventType: EventType; quantity: number;
  note: string | null; userSub: string | null; userName: string | null; createdAt: string;
}
export interface EventsPageDto { events: EventDto[]; nextCursor: string | null }
export interface RateDto { itemId: string; window: RateWindow; avgPerDay: number; days: number }

export type ShoppingEntry =
  | { kind: 'item'; itemId: string; name: string; unit: UnitDto; quantity: number; low: boolean; manual: boolean;
      rowId: string | null; currentCount: number; minStock: number; thumbUrl: string | null }
  | { kind: 'text'; rowId: string; name: string; quantity: number | null; checkedOff: boolean };
export interface ShoppingGroup { store: { id: string; name: string } | null; entries: ShoppingEntry[] }
export interface ShoppingListDto { groups: ShoppingGroup[] }
export interface PurchaseResultDto { eventId: string }

export interface PhotoUploadDto { key: string; uploadUrl: string; thumbUploadUrl: string }
export interface ApiError { error: { code: string; message: string; details?: unknown } }
```

`packages/shared/src/index.ts`:
```ts
export * from './constants.js';
export * from './schemas.js';
export * from './types.js';
```

- [ ] **Step 6: Run tests — expect pass**

Run: `pnpm --filter @plantry/shared test && pnpm --filter @plantry/shared typecheck`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo and shared contract package"
```

---

### Task 2: Prisma schema, app skeleton, error handling, test harness

**Files:**
- Create: `apps/backend/package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `scripts/test-db-setup.mjs`
- Create: `apps/backend/prisma/schema.prisma` (+ generated migration, hand-extended)
- Create: `apps/backend/src/app.ts`, `deps.ts`, `errors.ts`, `lib/num.ts`, `lib/ids.ts`
- Create: `apps/backend/src/test/helpers/setup.ts`, `db.ts`, `test-app.ts`
- Create: `.github/workflows/ci.yml`
- Test: `apps/backend/src/app.test.ts`

**Interfaces:**
- Consumes: `@plantry/shared` (`ErrorCode`).
- Produces:
  - `class AppError(status: number, code: ErrorCode, message: string, details?: unknown)`, `notFound(msg?)`, `forbidden(msg?)`, `parse(schema, data)` — `src/errors.ts`
  - `num(d: Prisma.Decimal | number): number`, `numOrNull(d)` — `src/lib/num.ts`; `isUuid(s: string): boolean` — `src/lib/ids.ts`
  - `interface Deps { prisma: PrismaClient; frontendOrigin: string }` — `src/deps.ts` (later tasks add optional fields)
  - `buildApp(options: BuildAppOptions): Promise<FastifyInstance>`; `app.routeTable: { method: string; url: string }[]`
  - Test harness: `createTestApp(): Promise<TestCtx>` with `ctx.call(user, method, url, body?) → { status, body, headers }`, `resetDatabase()`, `getTestPrisma()`
  - Prisma models: `User, Session, Household, HouseholdMember, HouseholdInvite, Store, Unit, Item, Inventory, InventoryEvent, ItemMerge, ShoppingListItem, PushSubscription, JobRun`; enums `MemberRole`, `EventType`

- [ ] **Step 1: Backend package config**

`apps/backend/package.json`:
```json
{
  "name": "@plantry/backend",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "dotenv -e ../../.env -- tsx watch src/server.ts",
    "build": "tsup",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:db:setup": "node scripts/test-db-setup.mjs",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "prisma": "dotenv -e ../../.env -- prisma"
  },
  "prisma": { "schema": "prisma/schema.prisma" },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.668.0",
    "@aws-sdk/s3-request-presigner": "^3.668.0",
    "@fastify/cookie": "^11.0.1",
    "@fastify/rate-limit": "^10.2.1",
    "@plantry/shared": "workspace:*",
    "@prisma/client": "^5.22.0",
    "fastify": "^5.1.0",
    "node-cron": "^3.0.3",
    "openid-client": "^5.7.0",
    "web-push": "^3.6.7",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "@types/node-cron": "^3.0.11",
    "@types/web-push": "^3.6.4",
    "dotenv-cli": "^7.4.2",
    "prisma": "^5.22.0",
    "tsup": "^8.3.5",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5"
  }
}
```

`apps/backend/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src/**/*.ts", "tsup.config.ts", "vitest.config.ts"] }
```

`apps/backend/tsup.config.ts` (bundles the TS-source shared package into the output; everything else stays external):
```ts
import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  noExternal: ['@plantry/shared'],
  sourcemap: true,
  clean: true,
});
```

`apps/backend/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/helpers/setup.ts'],
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
});
```

`apps/backend/scripts/test-db-setup.mjs`:
```js
import { execSync } from 'node:child_process';
const URL = process.env.TEST_DATABASE_URL ?? 'postgres://plantry:plantry@localhost:5434/plantry_test';
try {
  execSync('docker compose exec -T postgres psql -U plantry -d plantry -c "CREATE DATABASE plantry_test"', {
    stdio: 'inherit', cwd: new URL('../../..', import.meta.url),
  });
} catch { /* already exists */ }
execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: URL } });
```

- [ ] **Step 2: Prisma schema**

`apps/backend/prisma/schema.prisma`:
```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum MemberRole {
  owner
  member
}

enum EventType {
  restock
  consume
  adjust
  auto_deduct
}

model User {
  sub         String   @id
  name        String
  email       String
  lastLoginAt DateTime @map("last_login_at") @db.Timestamptz(6)
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  sessions        Session[]
  memberships     HouseholdMember[]
  invitesCreated  HouseholdInvite[]  @relation("InviteCreatedBy")
  invitesAccepted HouseholdInvite[]  @relation("InviteAcceptedBy")
  itemsArchived   Item[]             @relation("ItemArchivedBy")
  events          InventoryEvent[]
  merges          ItemMerge[]
  listRows        ShoppingListItem[]
  pushSubs        PushSubscription[]

  @@map("users")
}

model Session {
  idHash    String   @id @map("id_hash")
  userSub   String   @map("user_sub")
  data      Json
  expiresAt DateTime @map("expires_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  user      User     @relation(fields: [userSub], references: [sub], onDelete: Cascade)

  @@index([expiresAt])
  @@map("sessions")
}

model Household {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  members  HouseholdMember[]
  invites  HouseholdInvite[]
  stores   Store[]
  units    Unit[]
  items    Item[]
  events   InventoryEvent[]
  listRows ShoppingListItem[]

  @@map("households")
}

model HouseholdMember {
  householdId String     @map("household_id") @db.Uuid
  userSub     String     @map("user_sub")
  role        MemberRole
  joinedAt    DateTime   @default(now()) @map("joined_at") @db.Timestamptz(6)
  household   Household  @relation(fields: [householdId], references: [id], onDelete: Cascade)
  user        User       @relation(fields: [userSub], references: [sub], onDelete: Cascade)

  @@id([householdId, userSub])
  @@index([userSub])
  @@map("household_members")
}

model HouseholdInvite {
  id          String    @id @default(uuid()) @db.Uuid
  tokenHash   String    @unique @map("token_hash")
  householdId String    @map("household_id") @db.Uuid
  createdBy   String    @map("created_by")
  expiresAt   DateTime  @map("expires_at") @db.Timestamptz(6)
  acceptedBy  String?   @map("accepted_by")
  acceptedAt  DateTime? @map("accepted_at") @db.Timestamptz(6)
  household   Household @relation(fields: [householdId], references: [id], onDelete: Cascade)
  creator     User      @relation("InviteCreatedBy", fields: [createdBy], references: [sub], onDelete: Cascade)
  acceptor    User?     @relation("InviteAcceptedBy", fields: [acceptedBy], references: [sub], onDelete: SetNull)

  @@map("household_invites")
}

model Store {
  id          String    @id @default(uuid()) @db.Uuid
  householdId String    @map("household_id") @db.Uuid
  name        String
  notes       String?
  household   Household @relation(fields: [householdId], references: [id], onDelete: Cascade)
  items       Item[]
  listRows    ShoppingListItem[]

  @@index([householdId])
  @@map("stores")
}

model Unit {
  id           String     @id @default(uuid()) @db.Uuid
  name         String
  pluralName   String?    @map("plural_name")
  abbreviation String?
  householdId  String?    @map("household_id") @db.Uuid
  household    Household? @relation(fields: [householdId], references: [id], onDelete: Cascade)
  items        Item[]

  @@index([householdId])
  @@map("units")
}

model Item {
  id                   String    @id @default(uuid()) @db.Uuid
  householdId          String    @map("household_id") @db.Uuid
  name                 String
  description          String?
  category             String?
  unitId               String    @map("unit_id") @db.Uuid
  preferredStoreId     String?   @map("preferred_store_id") @db.Uuid
  barcode              String?
  imageRef             String?   @map("image_ref")
  renotifyAfterDays    Int       @default(7) @map("renotify_after_days")
  defaultRestockQty    Decimal   @default(1) @map("default_restock_qty") @db.Decimal(12, 3)
  autoDeductQty        Decimal?  @map("auto_deduct_qty") @db.Decimal(12, 3)
  autoDeductPeriodDays Int       @default(1) @map("auto_deduct_period_days")
  autoDeductPaused     Boolean   @default(false) @map("auto_deduct_paused")
  archivedAt           DateTime? @map("archived_at") @db.Timestamptz(6)
  archivedBy           String?   @map("archived_by")
  createdAt            DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt            DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  household      Household          @relation(fields: [householdId], references: [id], onDelete: Cascade)
  unit           Unit               @relation(fields: [unitId], references: [id], onDelete: Restrict)
  preferredStore Store?             @relation(fields: [preferredStoreId], references: [id], onDelete: SetNull)
  archiver       User?              @relation("ItemArchivedBy", fields: [archivedBy], references: [sub], onDelete: SetNull)
  inventory      Inventory?
  events         InventoryEvent[]
  listRows       ShoppingListItem[]
  mergesAsSource ItemMerge[]        @relation("MergeSource")
  mergesAsTarget ItemMerge[]        @relation("MergeTarget")

  @@index([householdId, archivedAt])
  @@map("items")
}

model Inventory {
  itemId           String    @id @map("item_id") @db.Uuid
  currentCount     Decimal   @default(0) @map("current_count") @db.Decimal(12, 3)
  minStock         Decimal   @default(0) @map("min_stock") @db.Decimal(12, 3)
  lastRestockedAt  DateTime? @map("last_restocked_at") @db.Timestamptz(6)
  lastCheckedOffAt DateTime? @map("last_checked_off_at") @db.Timestamptz(6)
  lastAutoDeductAt DateTime? @map("last_auto_deduct_at") @db.Timestamptz(6)
  lastNotifiedAt   DateTime? @map("last_notified_at") @db.Timestamptz(6)
  item             Item      @relation(fields: [itemId], references: [id], onDelete: Cascade)

  @@map("inventory")
}

model InventoryEvent {
  id          String    @id @default(uuid()) @db.Uuid
  itemId      String    @map("item_id") @db.Uuid
  householdId String    @map("household_id") @db.Uuid
  eventType   EventType @map("event_type")
  quantity    Decimal   @db.Decimal(12, 3)
  note        String?
  userSub     String?   @map("user_sub")
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  item        Item      @relation(fields: [itemId], references: [id], onDelete: Cascade)
  household   Household @relation(fields: [householdId], references: [id], onDelete: Cascade)
  user        User?     @relation(fields: [userSub], references: [sub], onDelete: SetNull)

  @@index([itemId, createdAt])
  @@index([householdId, createdAt])
  @@map("inventory_events")
}

model ItemMerge {
  id       String   @id @default(uuid()) @db.Uuid
  sourceId String   @map("source_id") @db.Uuid
  targetId String   @map("target_id") @db.Uuid
  mergedBy String?  @map("merged_by")
  mergedAt DateTime @default(now()) @map("merged_at") @db.Timestamptz(6)
  source   Item     @relation("MergeSource", fields: [sourceId], references: [id], onDelete: Cascade)
  target   Item     @relation("MergeTarget", fields: [targetId], references: [id], onDelete: Cascade)
  merger   User?    @relation(fields: [mergedBy], references: [sub], onDelete: SetNull)

  @@map("item_merges")
}

model ShoppingListItem {
  id           String    @id @default(uuid()) @db.Uuid
  householdId  String    @map("household_id") @db.Uuid
  itemId       String?   @map("item_id") @db.Uuid
  name         String
  storeId      String?   @map("store_id") @db.Uuid
  quantity     Decimal?  @db.Decimal(12, 3)
  addedBy      String?   @map("added_by")
  checkedOff   Boolean   @default(false) @map("checked_off")
  checkedOffAt DateTime? @map("checked_off_at") @db.Timestamptz(6)
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  household    Household @relation(fields: [householdId], references: [id], onDelete: Cascade)
  item         Item?     @relation(fields: [itemId], references: [id], onDelete: Cascade)
  store        Store?    @relation(fields: [storeId], references: [id], onDelete: SetNull)
  adder        User?     @relation(fields: [addedBy], references: [sub], onDelete: SetNull)

  @@index([householdId])
  @@map("shopping_list_items")
}

model PushSubscription {
  endpoint  String   @id
  userSub   String   @map("user_sub")
  p256dh    String
  auth      String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  user      User     @relation(fields: [userSub], references: [sub], onDelete: Cascade)

  @@index([userSub])
  @@map("push_subscriptions")
}

model JobRun {
  job       String    @id
  lastRunAt DateTime? @map("last_run_at") @db.Timestamptz(6)
  startedAt DateTime? @map("started_at") @db.Timestamptz(6)

  @@map("job_runs")
}
```

- [ ] **Step 3: Generate the migration, then hand-extend it**

```bash
docker compose up -d postgres
cp .env.example .env
pnpm install
pnpm --filter @plantry/backend prisma migrate dev --name init --create-only
```

Append to the end of the generated `apps/backend/prisma/migrations/<timestamp>_init/migration.sql`:
```sql
-- Partial unique indexes (not expressible in schema.prisma)
CREATE UNIQUE INDEX "items_household_barcode_active_key"
  ON "items" ("household_id", "barcode")
  WHERE "barcode" IS NOT NULL AND "archived_at" IS NULL;

CREATE UNIQUE INDEX "sli_household_item_open_key"
  ON "shopping_list_items" ("household_id", "item_id")
  WHERE "item_id" IS NOT NULL AND NOT "checked_off";

-- Check constraints
ALTER TABLE "items" ADD CONSTRAINT "items_default_restock_qty_pos" CHECK ("default_restock_qty" > 0);
ALTER TABLE "items" ADD CONSTRAINT "items_auto_deduct_qty_pos" CHECK ("auto_deduct_qty" IS NULL OR "auto_deduct_qty" > 0);
ALTER TABLE "items" ADD CONSTRAINT "items_auto_deduct_period_pos" CHECK ("auto_deduct_period_days" >= 1);

-- Global default units (household_id NULL)
INSERT INTO "units" ("id", "name", "plural_name", "abbreviation", "household_id") VALUES
  (gen_random_uuid(), 'each',   'each',    'ea',  NULL),
  (gen_random_uuid(), 'oz',     'oz',      'oz',  NULL),
  (gen_random_uuid(), 'lb',     'lb',      'lb',  NULL),
  (gen_random_uuid(), 'g',      'g',       'g',   NULL),
  (gen_random_uuid(), 'kg',     'kg',      'kg',  NULL),
  (gen_random_uuid(), 'ml',     'ml',      'ml',  NULL),
  (gen_random_uuid(), 'l',      'l',       'l',   NULL),
  (gen_random_uuid(), 'can',    'cans',    NULL,  NULL),
  (gen_random_uuid(), 'bottle', 'bottles', NULL,  NULL),
  (gen_random_uuid(), 'box',    'boxes',   NULL,  NULL),
  (gen_random_uuid(), 'bag',    'bags',    NULL,  NULL),
  (gen_random_uuid(), 'roll',   'rolls',   NULL,  NULL),
  (gen_random_uuid(), 'gallon', 'gallons', 'gal', NULL);
```

Then apply to dev and test DBs:
```bash
pnpm --filter @plantry/backend prisma migrate dev
pnpm --filter @plantry/backend test:db:setup
```
Expected: "Your database is now in sync", then "All migrations have been successfully applied."

> **Drift note for all later tasks:** if a future `prisma migrate dev` proposes `DROP INDEX "items_household_barcode_active_key"` or `"sli_household_item_open_key"`, delete those lines from the generated migration before applying.

- [ ] **Step 4: Test helpers**

`apps/backend/src/test/helpers/setup.ts`:
```ts
const TEST_URL = 'postgres://plantry:plantry@localhost:5434/plantry_test';
process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL'] ?? TEST_URL;
if (!process.env['DATABASE_URL'].endsWith('_test')) {
  throw new Error('Refusing to run tests: DATABASE_URL must end with _test');
}
```

`apps/backend/src/test/helpers/db.ts`:
```ts
import { PrismaClient } from '@prisma/client';

let client: PrismaClient | undefined;
export function getTestPrisma(): PrismaClient {
  client ??= new PrismaClient();
  return client;
}

/** Row-wise deletes (NOT TRUNCATE ... CASCADE, which would wipe the seeded global units). */
export async function resetDatabase(): Promise<void> {
  const p = getTestPrisma();
  await p.household.deleteMany();
  await p.unit.deleteMany({ where: { householdId: { not: null } } });
  await p.pushSubscription.deleteMany();
  await p.session.deleteMany();
  await p.user.deleteMany();
  await p.jobRun.deleteMany();
}
```

`apps/backend/src/test/helpers/test-app.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../../app.js';
import { getTestPrisma } from './db.js';

export const TEST_ORIGIN = 'http://localhost:5173';
export interface TestUser { sub: string; name: string; cookie: string }
export interface CallResult { status: number; body: any; headers: Record<string, unknown> }

export interface TestCtx {
  app: FastifyInstance;
  prisma: PrismaClient;
  call(user: TestUser | null, method: string, url: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<CallResult>;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestCtx> {
  const prisma = getTestPrisma();
  const app = await buildApp({ prisma, frontendOrigin: TEST_ORIGIN, sessionSecret: 'test-secret', cookieSecure: false });
  await app.ready();
  return {
    app,
    prisma,
    async call(user, method, url, body, extraHeaders = {}) {
      const res = await app.inject({
        method: method as 'GET',
        url,
        headers: {
          origin: TEST_ORIGIN,
          ...(user ? { cookie: user.cookie } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...extraHeaders,
        },
        ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
      });
      let parsed: unknown = null;
      try { parsed = res.body ? JSON.parse(res.body) : null; } catch { parsed = res.body; }
      return { status: res.statusCode, body: parsed, headers: res.headers };
    },
    async close() { await app.close(); },
  };
}
```

- [ ] **Step 5: Write the failing test**

`apps/backend/src/app.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from './test/helpers/test-app.js';
import { resetDatabase } from './test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);

describe('app skeleton', () => {
  it('GET /health', async () => {
    const r = await ctx.call(null, 'GET', '/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok' });
  });

  it('unknown routes use the error envelope', async () => {
    const r = await ctx.call(null, 'GET', '/api/nope');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('not_found');
  });

  it('rejects mutations from a foreign origin', async () => {
    const r = await ctx.call(null, 'POST', '/api/nope', {}, { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('forbidden');
  });

  it('seeds 13 global units and reset keeps them', async () => {
    expect(await ctx.prisma.unit.count({ where: { householdId: null } })).toBe(13);
  });

  it('exposes a route table', () => {
    expect(ctx.app.routeTable.some((r) => r.url === '/health')).toBe(true);
  });
});
```

- [ ] **Step 6: Run — expect failure**

Run: `pnpm --filter @plantry/backend test`
Expected: FAIL — cannot find `../../app.js`.

- [ ] **Step 7: Implement**

`apps/backend/src/errors.ts`:
```ts
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
```

`apps/backend/src/lib/num.ts`:
```ts
import type { Prisma } from '@prisma/client';
export const num = (d: Prisma.Decimal | number): number => Number(d);
export const numOrNull = (d: Prisma.Decimal | number | null | undefined): number | null => (d == null ? null : Number(d));
```

`apps/backend/src/lib/ids.ts`:
```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s);
```

`apps/backend/src/deps.ts`:
```ts
import type { PrismaClient } from '@prisma/client';
export interface Deps {
  prisma: PrismaClient;
  frontendOrigin: string;
}
```

`apps/backend/src/app.ts`:
```ts
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import type { PrismaClient } from '@prisma/client';
import { AppError } from './errors.js';
import type { Deps } from './deps.js';

declare module 'fastify' {
  interface FastifyInstance {
    routeTable: { method: string; url: string }[];
  }
}

export interface BuildAppOptions {
  logger?: boolean;
  prisma: PrismaClient;
  frontendOrigin: string;
  sessionSecret: string;
  cookieSecure: boolean;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, trustProxy: true });
  const deps: Deps = { prisma: options.prisma, frontendOrigin: options.frontendOrigin };
  void deps; // consumed by route registration added in later tasks

  app.decorate('routeTable', []);
  app.addHook('onRoute', (r) => {
    for (const method of Array.isArray(r.method) ? r.method : [r.method]) {
      if (method !== 'HEAD') app.routeTable.push({ method, url: r.url });
    }
  });

  await app.register(cookie, { secret: options.sessionSecret });

  app.addHook('onRequest', async (req) => {
    if (SAFE_METHODS.has(req.method)) return;
    if (req.headers.origin !== options.frontendOrigin) throw new AppError(403, 'forbidden', 'Bad origin');
  });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({
        error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
      });
    }
    const status = (err as FastifyError).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: 'validation_error', message: err.message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal', message: 'Internal error' } });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } }),
  );

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
```

- [ ] **Step 8: Run — expect pass**

Run: `pnpm --filter @plantry/backend test && pnpm --filter @plantry/backend typecheck`
Expected: 5 tests PASS, typecheck clean.

- [ ] **Step 9: CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env: { POSTGRES_USER: plantry, POSTGRES_PASSWORD: plantry, POSTGRES_DB: plantry_test }
        ports: ["5434:5432"]
        options: >-
          --health-cmd "pg_isready -U plantry" --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      TEST_DATABASE_URL: postgres://plantry:plantry@localhost:5434/plantry_test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @plantry/backend exec prisma generate
      - run: pnpm --filter @plantry/backend exec prisma migrate deploy
        env: { DATABASE_URL: "postgres://plantry:plantry@localhost:5434/plantry_test" }
      - run: pnpm typecheck
      - run: pnpm test
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(backend): prisma schema, app skeleton, error envelope, test harness"
```

---

### Task 3: Auth — PG sessions, OIDC, middleware, `/me`, dev bypass

**Files:**
- Create: `apps/backend/src/auth/session.ts`, `oidc.ts`, `middleware.ts`, `routes.ts`, `dev-bypass.ts`
- Modify: `apps/backend/src/app.ts`, `apps/backend/src/test/helpers/test-app.ts`
- Create: `apps/backend/src/test/helpers/fakes.ts`
- Test: `apps/backend/src/auth/session.test.ts`, `apps/backend/src/auth/routes.test.ts`

**Interfaces:**
- Consumes: `AppError`, `Deps`, `buildApp`, `TestCtx`.
- Produces:
  - `interface SessionData { groups: string[]; idToken?: string }`
  - `interface SessionStore { create(userSub, data): Promise<string>; get(sid): Promise<{ userSub: string; data: SessionData; expiresAt: Date } | null>; touch(sid): Promise<void>; destroy(sid): Promise<void> }`, `createSessionStore(prisma, ttlSeconds)`, `hashSid(sid)`
  - `interface OidcClient` / `OidcUserinfo` (adds `idToken?: string`) / `createOidcClient(config)`
  - `req.user: { sub: string; name: string; email: string; isAdmin: boolean }`; `app.requireAuth`, `app.requireAdmin` (both **throw** `AppError`)
  - Routes: `GET /api/auth/login`, `GET /api/auth/callback`, `POST /api/auth/logout`, `GET /api/me`; dev-only `GET /api/auth/dev-login?sub=&name=&admin=`
  - `BuildAppOptions` gains `oidcClient: OidcClient`, `adminGroup?: string`, `sessionTtlSeconds?: number`, `devBypass?: boolean`
  - Test harness gains `ctx.user(opts?: { name?: string; admin?: boolean }): Promise<TestUser>`, `ctx.fakeOidc: FakeOidcClient`

- [ ] **Step 1: Failing session-store test**

`apps/backend/src/auth/session.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { getTestPrisma, resetDatabase } from '../test/helpers/db.js';
import { createSessionStore, hashSid } from './session.js';

const prisma = getTestPrisma();
beforeEach(async () => {
  await resetDatabase();
  await prisma.user.create({ data: { sub: 'u1', name: 'U', email: 'u@x', lastLoginAt: new Date() } });
});

describe('session store', () => {
  it('creates, reads and destroys; stores only the hash', async () => {
    const store = createSessionStore(prisma, 3600);
    const sid = await store.create('u1', { groups: ['plantry-admins'] });
    expect(sid.length).toBeGreaterThanOrEqual(43);
    expect(await prisma.session.findUnique({ where: { idHash: sid } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { idHash: hashSid(sid) } })).not.toBeNull();
    expect((await store.get(sid))?.data.groups).toEqual(['plantry-admins']);
    await store.destroy(sid);
    expect(await store.get(sid)).toBeNull();
  });

  it('treats expired sessions as missing and deletes them', async () => {
    const store = createSessionStore(prisma, -1);
    const sid = await store.create('u1', { groups: [] });
    expect(await store.get(sid)).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });

  it('touch slides the expiry forward', async () => {
    const store = createSessionStore(prisma, 3600);
    const sid = await store.create('u1', { groups: [] });
    await prisma.session.update({ where: { idHash: hashSid(sid) }, data: { expiresAt: new Date(Date.now() + 1000) } });
    await store.touch(sid);
    const s = await store.get(sid);
    expect(s!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 3000_000);
  });
});
```

Run: `pnpm --filter @plantry/backend test src/auth/session.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement the session store**

`apps/backend/src/auth/session.ts`:
```ts
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

export interface SessionData { groups: string[]; idToken?: string }
export interface SessionRecord { userSub: string; data: SessionData; expiresAt: Date }
export interface SessionStore {
  create(userSub: string, data: SessionData): Promise<string>;
  get(sid: string): Promise<SessionRecord | null>;
  touch(sid: string): Promise<void>;
  destroy(sid: string): Promise<void>;
}

export const hashSid = (sid: string): string => createHash('sha256').update(sid).digest('hex');

export function createSessionStore(prisma: PrismaClient, ttlSeconds: number): SessionStore {
  const expiry = () => new Date(Date.now() + ttlSeconds * 1000);
  return {
    async create(userSub, data) {
      const sid = randomBytes(32).toString('base64url');
      await prisma.session.create({
        data: { idHash: hashSid(sid), userSub, data: data as unknown as Prisma.InputJsonValue, expiresAt: expiry() },
      });
      return sid;
    },
    async get(sid) {
      const row = await prisma.session.findUnique({ where: { idHash: hashSid(sid) } });
      if (!row) return null;
      if (row.expiresAt.getTime() <= Date.now()) {
        await prisma.session.deleteMany({ where: { idHash: row.idHash } });
        return null;
      }
      return { userSub: row.userSub, data: row.data as unknown as SessionData, expiresAt: row.expiresAt };
    },
    async touch(sid) {
      await prisma.session.updateMany({ where: { idHash: hashSid(sid) }, data: { expiresAt: expiry() } });
    },
    async destroy(sid) {
      await prisma.session.deleteMany({ where: { idHash: hashSid(sid) } });
    },
  };
}
```

Run the session test → PASS.

- [ ] **Step 3: OIDC client**

`apps/backend/src/auth/oidc.ts` — copy `D:\code\Velvet Scoop\website-v2\apps\backend\src\auth\oidc.ts` verbatim, then make exactly two changes:

1. Add `idToken?: string;` to `interface OidcUserinfo`.
2. In `exchange`, add `idToken: tokenSet.id_token,` to the returned object.

(The file keeps the lazy-discovery, retry-on-rejection, 10 s timeout, and the Authentik groups scope `goauthentik.io/providers/oauth2/scope-groups` default — all required in this homelab.)

- [ ] **Step 4: Fakes + harness `user()`**

`apps/backend/src/test/helpers/fakes.ts`:
```ts
import type { OidcClient, OidcUserinfo } from '../../auth/oidc.js';

export class FakeOidcClient implements OidcClient {
  userinfo: OidcUserinfo = { sub: 'sub-0', email: 'fake@example.com', name: 'Fake', groups: [], idToken: 'idt' };
  authorizationUrl() {
    return { url: 'https://auth.example/authorize', state: 'state-0', nonce: 'nonce-0', codeVerifier: 'cv-0' };
  }
  async exchange() { return this.userinfo; }
  endSessionUrl() { return 'https://auth.example/logout'; }
}
```

In `apps/backend/src/test/helpers/test-app.ts`:
- add imports:
```ts
import { createSessionStore } from '../../auth/session.js';
import { FakeOidcClient } from './fakes.js';
export const TEST_COOKIE = 'plantry_sid';
```
- extend `TestCtx` with:
```ts
  fakeOidc: FakeOidcClient;
  user(opts?: { name?: string; admin?: boolean }): Promise<TestUser>;
```
- in `createTestApp`, build with the fake and add `user`:
```ts
  const fakeOidc = new FakeOidcClient();
  const sessions = createSessionStore(prisma, 3600);
  const app = await buildApp({
    prisma, frontendOrigin: TEST_ORIGIN, sessionSecret: 'test-secret', cookieSecure: false,
    oidcClient: fakeOidc, adminGroup: 'plantry-admins', devBypass: false,
  });
  let n = 0;
  // ...inside the returned object:
    fakeOidc,
    async user(opts = {}) {
      n++;
      const sub = `sub-${Date.now()}-${n}`;
      const name = opts.name ?? `User ${n}`;
      await prisma.user.create({ data: { sub, name, email: `u${n}@example.com`, lastLoginAt: new Date() } });
      const sid = await sessions.create(sub, { groups: opts.admin ? ['plantry-admins'] : [] });
      return { sub, name, cookie: `${TEST_COOKIE}=${sid}` };
    },
```

- [ ] **Step 5: Failing routes test**

`apps/backend/src/auth/routes.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);

function cookieFrom(headers: Record<string, unknown>, name: string): string | undefined {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  const hit = list.find((c) => c.startsWith(`${name}=`));
  return hit?.split(';')[0];
}

describe('auth', () => {
  it('login sets the signed state cookie and redirects to the provider', async () => {
    const r = await ctx.call(null, 'GET', '/api/auth/login');
    expect(r.status).toBe(302);
    expect(r.headers['location']).toBe('https://auth.example/authorize');
    expect(cookieFrom(r.headers, 'plantry_oidc')).toBeDefined();
  });

  it('callback upserts the user, creates a session, redirects home', async () => {
    ctx.fakeOidc.userinfo = { sub: 'abc', email: 'a@b.c', name: 'Ada', groups: ['plantry-admins'], idToken: 't' };
    const login = await ctx.call(null, 'GET', '/api/auth/login');
    const state = cookieFrom(login.headers, 'plantry_oidc')!;
    const cb = await ctx.call(null, 'GET', '/api/auth/callback?code=c&state=state-0', undefined, { cookie: state });
    expect(cb.status).toBe(302);
    expect(cb.headers['location']).toBe('http://localhost:5173/');
    const sid = cookieFrom(cb.headers, 'plantry_sid')!;
    expect(sid).toBeDefined();
    const me = await ctx.call(null, 'GET', '/api/me', undefined, { cookie: sid });
    expect(me.status).toBe(200);
    expect(me.body.data.user).toEqual({ sub: 'abc', name: 'Ada', email: 'a@b.c', isAdmin: true });
    expect(me.body.data.households).toEqual([]);
  });

  it('callback rejects a state mismatch', async () => {
    const login = await ctx.call(null, 'GET', '/api/auth/login');
    const state = cookieFrom(login.headers, 'plantry_oidc')!;
    const cb = await ctx.call(null, 'GET', '/api/auth/callback?code=c&state=WRONG', undefined, { cookie: state });
    expect(cb.status).toBe(400);
  });

  it('/me is 401 without a session and isAdmin=false for plain users', async () => {
    expect((await ctx.call(null, 'GET', '/api/me')).status).toBe(401);
    const u = await ctx.user();
    const me = await ctx.call(u, 'GET', '/api/me');
    expect(me.body.data.user.isAdmin).toBe(false);
  });

  it('logout destroys the session', async () => {
    const u = await ctx.user();
    const out = await ctx.call(u, 'POST', '/api/auth/logout');
    expect(out.status).toBe(200);
    expect(out.body.data.endSessionUrl).toBe('https://auth.example/logout');
    expect((await ctx.call(u, 'GET', '/api/me')).status).toBe(401);
  });

  it('dev-login does not exist unless devBypass is on', async () => {
    expect((await ctx.call(null, 'GET', '/api/auth/dev-login?sub=x')).status).toBe(404);
  });
});
```

Run → FAIL.

- [ ] **Step 6: Middleware**

`apps/backend/src/auth/middleware.ts`:
```ts
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { AppError, forbidden } from '../errors.js';
import type { SessionStore } from './session.js';

export interface RequestUser { sub: string; name: string; email: string; isAdmin: boolean }

declare module 'fastify' {
  interface FastifyRequest { user?: RequestUser }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export interface AuthMiddlewareDeps {
  prisma: PrismaClient;
  sessionStore: SessionStore;
  cookieName: string;
  cookieSecure: boolean;
  ttlSeconds: number;
  adminGroup: string;
}

const unauthorized = (m: string) => new AppError(401, 'unauthorized', m);

export function makeRequireAuth(deps: AuthMiddlewareDeps) {
  return async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const sid = req.cookies[deps.cookieName];
    if (!sid) throw unauthorized('No session');
    const session = await deps.sessionStore.get(sid);
    if (!session) throw unauthorized('Invalid session');
    const user = await deps.prisma.user.findUnique({ where: { sub: session.userSub } });
    if (!user) throw unauthorized('User not found');

    // Sliding expiry: once less than 6/7 of the TTL remains, extend DB row and cookie.
    const remainingMs = session.expiresAt.getTime() - Date.now();
    if (remainingMs < deps.ttlSeconds * 1000 * (6 / 7)) {
      await deps.sessionStore.touch(sid);
      reply.setCookie(deps.cookieName, sid, {
        path: '/', httpOnly: true, sameSite: 'lax', secure: deps.cookieSecure, maxAge: deps.ttlSeconds,
      });
    }
    req.user = {
      sub: user.sub, name: user.name, email: user.email,
      isAdmin: session.data.groups.includes(deps.adminGroup),
    };
  };
}

export function makeRequireAdmin() {
  return async function requireAdmin(req: FastifyRequest): Promise<void> {
    if (!req.user) throw unauthorized('No user');
    if (!req.user.isAdmin) throw forbidden('Admin required');
  };
}
```

- [ ] **Step 7: Auth routes + dev bypass**

`apps/backend/src/auth/routes.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { MeDto } from '@plantry/shared';
import { AppError } from '../errors.js';
import type { OidcClient } from './oidc.js';
import type { SessionStore } from './session.js';

export interface AuthRouteDeps {
  prisma: PrismaClient;
  sessionStore: SessionStore;
  oidcClient: OidcClient;
  cookieName: string;
  cookieSecure: boolean;
  ttlSeconds: number;
  frontendOrigin: string;
  photosEnabled: boolean;
  pushEnabled: boolean;
}

interface PkcePayload { state: string; nonce: string; codeVerifier: string }
const PKCE_COOKIE = 'plantry_oidc';
const bad = (m: string) => new AppError(400, 'validation_error', m);

const encode = (p: PkcePayload) => Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');
function decode(v: string): PkcePayload | null {
  try {
    const p = JSON.parse(Buffer.from(v, 'base64url').toString('utf8')) as PkcePayload;
    return typeof p.state === 'string' && typeof p.nonce === 'string' && typeof p.codeVerifier === 'string' ? p : null;
  } catch { return null; }
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const limit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.get('/api/auth/login', limit, async (_req, reply) => {
    const a = await deps.oidcClient.authorizationUrl();
    reply.setCookie(PKCE_COOKIE, encode({ state: a.state, nonce: a.nonce, codeVerifier: a.codeVerifier }), {
      path: '/api/auth', httpOnly: true, sameSite: 'lax', secure: deps.cookieSecure, signed: true, maxAge: 600,
    });
    return reply.redirect(a.url);
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/auth/callback', limit, async (req, reply) => {
      const { code, state, error } = req.query;
      if (error) throw bad(`Provider returned: ${error}`);
      if (!code || !state) throw bad('Missing code or state');
      const raw = req.cookies[PKCE_COOKIE];
      const unsigned = raw ? req.unsignCookie(raw) : null;
      const payload = unsigned?.valid && unsigned.value ? decode(unsigned.value) : null;
      if (!payload || payload.state !== state) throw bad('State mismatch');

      let info;
      try {
        info = await deps.oidcClient.exchange({ code, state, nonce: payload.nonce, codeVerifier: payload.codeVerifier });
      } catch (err) {
        req.log.error({ err }, 'oidc exchange failed');
        throw bad('Token exchange failed');
      }
      const name = info.name?.trim() || info.preferred_username?.trim() || info.email || info.sub;
      await deps.prisma.user.upsert({
        where: { sub: info.sub },
        create: { sub: info.sub, name, email: info.email, lastLoginAt: new Date() },
        update: { name, email: info.email, lastLoginAt: new Date() },
      });
      reply.clearCookie(PKCE_COOKIE, { path: '/api/auth' });
      const sid = await deps.sessionStore.create(info.sub, {
        groups: info.groups, ...(info.idToken ? { idToken: info.idToken } : {}),
      });
      reply.setCookie(deps.cookieName, sid, {
        path: '/', httpOnly: true, sameSite: 'lax', secure: deps.cookieSecure, maxAge: deps.ttlSeconds,
      });
      return reply.redirect(`${deps.frontendOrigin}/`);
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const sid = req.cookies[deps.cookieName];
    let idTokenHint: string | undefined;
    if (sid) {
      idTokenHint = (await deps.sessionStore.get(sid))?.data.idToken;
      await deps.sessionStore.destroy(sid);
    }
    reply.clearCookie(deps.cookieName, { path: '/' });
    const endSessionUrl = deps.oidcClient.endSessionUrl
      ? await deps.oidcClient.endSessionUrl({
          postLogoutRedirectUri: deps.frontendOrigin, ...(idTokenHint ? { idTokenHint } : {}),
        })
      : null;
    return { data: { ok: true, endSessionUrl } };
  });

  app.get('/api/me', { preHandler: app.requireAuth }, async (req) => {
    const memberships = await deps.prisma.householdMember.findMany({
      where: { userSub: req.user!.sub }, include: { household: true }, orderBy: { joinedAt: 'asc' },
    });
    const data: MeDto = {
      user: req.user!,
      households: memberships.map((m) => ({ id: m.householdId, name: m.household.name, role: m.role })),
      photosEnabled: deps.photosEnabled,
      pushEnabled: deps.pushEnabled,
    };
    return { data };
  });
}
```

`apps/backend/src/auth/dev-bypass.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import type { AuthRouteDeps } from './routes.js';

/** Local dev + Playwright only. server.ts refuses to enable this when NODE_ENV=production. */
export function registerDevBypass(app: FastifyInstance, deps: AuthRouteDeps, adminGroup: string): void {
  app.get<{ Querystring: { sub?: string; name?: string; admin?: string } }>('/api/auth/dev-login', async (req, reply) => {
    const sub = req.query.sub ?? 'dev-user';
    const name = req.query.name ?? 'Dev User';
    await deps.prisma.user.upsert({
      where: { sub },
      create: { sub, name, email: `${sub}@dev.local`, lastLoginAt: new Date() },
      update: { name, lastLoginAt: new Date() },
    });
    const sid = await deps.sessionStore.create(sub, { groups: req.query.admin === '1' ? [adminGroup] : [] });
    reply.setCookie(deps.cookieName, sid, { path: '/', httpOnly: true, sameSite: 'lax', secure: false, maxAge: deps.ttlSeconds });
    return reply.redirect(`${deps.frontendOrigin}/`);
  });
}
```

- [ ] **Step 8: Wire into `app.ts`**

In `apps/backend/src/app.ts`:
- add imports:
```ts
import rateLimit from '@fastify/rate-limit';
import { makeRequireAdmin, makeRequireAuth } from './auth/middleware.js';
import { registerAuthRoutes, type AuthRouteDeps } from './auth/routes.js';
import { registerDevBypass } from './auth/dev-bypass.js';
import { createSessionStore } from './auth/session.js';
import type { OidcClient } from './auth/oidc.js';
```
- extend `BuildAppOptions`:
```ts
  oidcClient: OidcClient;
  adminGroup?: string;
  sessionTtlSeconds?: number;
  devBypass?: boolean;
  disableRateLimit?: boolean;
```
- after the cookie plugin registration:
```ts
  if (!options.disableRateLimit) {
    await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute', allowList: (req) => req.url === '/health' });
  }
  const cookieName = 'plantry_sid';
  const ttlSeconds = options.sessionTtlSeconds ?? 7 * 24 * 60 * 60;
  const adminGroup = options.adminGroup ?? 'plantry-admins';
  const sessionStore = createSessionStore(options.prisma, ttlSeconds);
  app.decorate('requireAuth', makeRequireAuth({
    prisma: options.prisma, sessionStore, cookieName, cookieSecure: options.cookieSecure, ttlSeconds, adminGroup,
  }));
  app.decorate('requireAdmin', makeRequireAdmin());
```
- after `/health`:
```ts
  const authDeps: AuthRouteDeps = {
    prisma: options.prisma, sessionStore, oidcClient: options.oidcClient, cookieName,
    cookieSecure: options.cookieSecure, ttlSeconds, frontendOrigin: options.frontendOrigin,
    photosEnabled: false, pushEnabled: false,
  };
  registerAuthRoutes(app, authDeps);
  if (options.devBypass) registerDevBypass(app, authDeps, adminGroup);
```
- in the test harness `buildApp({...})` call add `disableRateLimit: true`.

- [ ] **Step 9: Run — expect pass**

Run: `pnpm --filter @plantry/backend test && pnpm --filter @plantry/backend typecheck`
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(backend): OIDC login, PostgreSQL sessions, /me, dev bypass"
```

---

### Task 4: Households, scoped plugin, members & roles

**Files:**
- Create: `apps/backend/src/households/routes.ts`, `apps/backend/src/households/service.ts`
- Create: `apps/backend/src/scoped/index.ts`, `apps/backend/src/scoped/members.ts`
- Modify: `apps/backend/src/app.ts`, `apps/backend/src/test/helpers/test-app.ts`
- Test: `apps/backend/src/households/households.test.ts`

**Interfaces:**
- Consumes: `app.requireAuth`, `Deps`, `parse`, `notFound`, `forbidden`, `AppError`, `isUuid`, shared `householdNameSchema`, `memberRoleSchema`, `MemberDto`.
- Produces:
  - `req.household: { id: string; role: 'owner' | 'member' }` on every scoped route
  - `registerScoped(app: FastifyInstance, deps: Deps): Promise<void>` — later tasks add one `registerXRoutes(s, deps)` line each inside it
  - `requireOwner(req)` helper exported from `scoped/index.ts` (throws 403 `forbidden`)
  - `leaveHousehold(prisma, hid, sub): Promise<{ householdDeleted: boolean; imageRefs: string[] }>`, `removeMember`, `setRole` — `households/service.ts`
  - Routes: `POST /api/households`; under `/api/households/:hid`: `PATCH /`, `GET /members`, `PATCH /members/:sub`, `DELETE /members/me`, `DELETE /members/:sub`
  - Test harness gains `ctx.household(owner, name?) → Promise<string>` and `ctx.addMember(hid, user, role?)`

- [ ] **Step 1: Harness helpers**

Add to `TestCtx` and the returned object in `test-app.ts`:
```ts
  household(owner: TestUser, name?: string): Promise<string>;
  addMember(hid: string, user: TestUser, role?: 'owner' | 'member'): Promise<void>;
```
```ts
    async household(owner, name = 'Casa') {
      const h = await prisma.household.create({
        data: { name, members: { create: { userSub: owner.sub, role: 'owner' } } },
      });
      return h.id;
    },
    async addMember(hid, user, role = 'member') {
      await prisma.householdMember.create({ data: { householdId: hid, userSub: user.sub, role } });
    },
```

- [ ] **Step 2: Failing test**

`apps/backend/src/households/households.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);

describe('households', () => {
  it('creator becomes owner and it shows in /me', async () => {
    const u = await ctx.user();
    const r = await ctx.call(u, 'POST', '/api/households', { name: 'Casa' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ name: 'Casa', role: 'owner' });
    const me = await ctx.call(u, 'GET', '/api/me');
    expect(me.body.data.households).toHaveLength(1);
  });

  it('non-members and malformed ids get 404', async () => {
    const owner = await ctx.user(); const stranger = await ctx.user();
    const hid = await ctx.household(owner);
    expect((await ctx.call(stranger, 'GET', `/api/households/${hid}/members`)).status).toBe(404);
    expect((await ctx.call(owner, 'GET', '/api/households/not-a-uuid/members')).status).toBe(404);
    expect((await ctx.call(null, 'GET', `/api/households/${hid}/members`)).status).toBe(401);
  });

  it('lists members with names', async () => {
    const owner = await ctx.user({ name: 'Olive' }); const m = await ctx.user({ name: 'Max' });
    const hid = await ctx.household(owner); await ctx.addMember(hid, m);
    const r = await ctx.call(m, 'GET', `/api/households/${hid}/members`);
    expect(r.body.data.map((x: any) => [x.name, x.role])).toEqual([['Olive', 'owner'], ['Max', 'member']]);
  });

  it('only owners rename, change roles, remove', async () => {
    const owner = await ctx.user(); const m = await ctx.user();
    const hid = await ctx.household(owner); await ctx.addMember(hid, m);
    expect((await ctx.call(m, 'PATCH', `/api/households/${hid}`, { name: 'X' })).status).toBe(403);
    expect((await ctx.call(m, 'PATCH', `/api/households/${hid}/members/${owner.sub}`, { role: 'member' })).status).toBe(403);
    expect((await ctx.call(m, 'DELETE', `/api/households/${hid}/members/${owner.sub}`)).status).toBe(403);
    expect((await ctx.call(owner, 'PATCH', `/api/households/${hid}`, { name: 'X' })).status).toBe(200);
    expect((await ctx.call(owner, 'DELETE', `/api/households/${hid}/members/${m.sub}`)).status).toBe(204);
    expect((await ctx.call(m, 'GET', `/api/households/${hid}/members`)).status).toBe(404);
  });

  it('last owner cannot leave or demote self while others remain', async () => {
    const owner = await ctx.user(); const m = await ctx.user();
    const hid = await ctx.household(owner); await ctx.addMember(hid, m);
    const leave = await ctx.call(owner, 'DELETE', `/api/households/${hid}/members/me`);
    expect(leave.status).toBe(409);
    expect(leave.body.error.code).toBe('last_owner');
    const demote = await ctx.call(owner, 'PATCH', `/api/households/${hid}/members/${owner.sub}`, { role: 'member' });
    expect(demote.body.error.code).toBe('last_owner');
    // promote, then leaving works
    expect((await ctx.call(owner, 'PATCH', `/api/households/${hid}/members/${m.sub}`, { role: 'owner' })).status).toBe(200);
    expect((await ctx.call(owner, 'DELETE', `/api/households/${hid}/members/me`)).status).toBe(204);
  });

  it('last member leaving deletes the household', async () => {
    const owner = await ctx.user();
    const hid = await ctx.household(owner);
    expect((await ctx.call(owner, 'DELETE', `/api/households/${hid}/members/me`)).status).toBe(204);
    expect(await ctx.prisma.household.findUnique({ where: { id: hid } })).toBeNull();
  });
});
```

Run → FAIL (404s everywhere).

- [ ] **Step 3: Service**

`apps/backend/src/households/service.ts`:
```ts
import type { MemberRole, PrismaClient } from '@prisma/client';
import { AppError, notFound } from '../errors.js';

const lastOwner = () => new AppError(409, 'last_owner', 'Assign another owner first');

export async function leaveHousehold(prisma: PrismaClient, hid: string, sub: string) {
  return prisma.$transaction(async (tx) => {
    const members = await tx.householdMember.findMany({ where: { householdId: hid } });
    const me = members.find((m) => m.userSub === sub);
    if (!me) throw notFound();
    if (members.length === 1) {
      const items = await tx.item.findMany({ where: { householdId: hid, imageRef: { not: null } }, select: { imageRef: true } });
      await tx.household.delete({ where: { id: hid } });
      return { householdDeleted: true, imageRefs: items.map((i) => i.imageRef!) };
    }
    if (me.role === 'owner' && members.filter((m) => m.role === 'owner').length === 1) throw lastOwner();
    await tx.householdMember.delete({ where: { householdId_userSub: { householdId: hid, userSub: sub } } });
    return { householdDeleted: false, imageRefs: [] as string[] };
  });
}

export async function removeMember(prisma: PrismaClient, hid: string, targetSub: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const members = await tx.householdMember.findMany({ where: { householdId: hid } });
    const target = members.find((m) => m.userSub === targetSub);
    if (!target) throw notFound();
    if (target.role === 'owner' && members.filter((m) => m.role === 'owner').length === 1) throw lastOwner();
    await tx.householdMember.delete({ where: { householdId_userSub: { householdId: hid, userSub: targetSub } } });
  });
}

export async function setRole(prisma: PrismaClient, hid: string, targetSub: string, role: MemberRole): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const members = await tx.householdMember.findMany({ where: { householdId: hid } });
    const target = members.find((m) => m.userSub === targetSub);
    if (!target) throw notFound();
    if (target.role === 'owner' && role === 'member' && members.filter((m) => m.role === 'owner').length === 1) {
      throw lastOwner();
    }
    await tx.householdMember.update({
      where: { householdId_userSub: { householdId: hid, userSub: targetSub } }, data: { role },
    });
  });
}
```

- [ ] **Step 4: Routes**

`apps/backend/src/households/routes.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { householdNameSchema, type HouseholdSummary } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { parse } from '../errors.js';

export function registerHouseholdRoutes(app: FastifyInstance, deps: Deps): void {
  app.post('/api/households', { preHandler: app.requireAuth }, async (req) => {
    const { name } = parse(householdNameSchema, req.body);
    const h = await deps.prisma.household.create({
      data: { name, members: { create: { userSub: req.user!.sub, role: 'owner' } } },
    });
    const data: HouseholdSummary = { id: h.id, name: h.name, role: 'owner' };
    return { data };
  });
}
```

`apps/backend/src/scoped/index.ts`:
```ts
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MemberRole } from '@prisma/client';
import type { Deps } from '../deps.js';
import { forbidden, notFound } from '../errors.js';
import { isUuid } from '../lib/ids.js';
import { registerMemberRoutes } from './members.js';

declare module 'fastify' {
  interface FastifyRequest { household?: { id: string; role: MemberRole } }
}

export function requireOwner(req: FastifyRequest): void {
  if (req.household?.role !== 'owner') throw forbidden('Owner required');
}

export async function registerScoped(app: FastifyInstance, deps: Deps): Promise<void> {
  await app.register(async (s) => {
    s.addHook('preHandler', app.requireAuth);
    s.addHook('preHandler', async (req) => {
      const hid = (req.params as { hid?: string }).hid;
      if (!isUuid(hid)) throw notFound();
      const m = await deps.prisma.householdMember.findUnique({
        where: { householdId_userSub: { householdId: hid, userSub: req.user!.sub } },
      });
      if (!m) throw notFound();
      req.household = { id: hid, role: m.role };
    });

    registerMemberRoutes(s, deps);
    // Later tasks append: registerInviteCreateRoute, registerStoreRoutes, registerUnitRoutes, registerItemRoutes,
    // registerInventoryRoutes, registerRateRoutes, registerShoppingRoutes, registerPhotoRoutes
  }, { prefix: '/api/households/:hid' });
}
```

`apps/backend/src/scoped/members.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { householdNameSchema, memberRoleSchema, type MemberDto } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { parse } from '../errors.js';
import { leaveHousehold, removeMember, setRole } from '../households/service.js';
import { requireOwner } from './index.js';

export function registerMemberRoutes(s: FastifyInstance, deps: Deps): void {
  s.patch('/', async (req) => {
    requireOwner(req);
    const { name } = parse(householdNameSchema, req.body);
    const h = await deps.prisma.household.update({ where: { id: req.household!.id }, data: { name } });
    return { data: { id: h.id, name: h.name, role: req.household!.role } };
  });

  s.get('/members', async (req) => {
    const rows = await deps.prisma.householdMember.findMany({
      where: { householdId: req.household!.id }, include: { user: true }, orderBy: { joinedAt: 'asc' },
    });
    const data: MemberDto[] = rows.map((m) => ({
      sub: m.userSub, name: m.user.name, email: m.user.email, role: m.role, joinedAt: m.joinedAt.toISOString(),
    }));
    return { data };
  });

  // NOTE: '/members/me' must be registered before '/members/:sub' reads clearly; find-my-way prefers static segments anyway.
  s.delete('/members/me', async (req, reply) => {
    await leaveHousehold(deps.prisma, req.household!.id, req.user!.sub);
    return reply.code(204).send();
  });

  s.patch<{ Params: { sub: string } }>('/members/:sub', async (req) => {
    requireOwner(req);
    const { role } = parse(memberRoleSchema, req.body);
    await setRole(deps.prisma, req.household!.id, req.params.sub, role);
    return { data: { sub: req.params.sub, role } };
  });

  s.delete<{ Params: { sub: string } }>('/members/:sub', async (req, reply) => {
    requireOwner(req);
    await removeMember(deps.prisma, req.household!.id, req.params.sub);
    return reply.code(204).send();
  });
}
```

In `app.ts`: import `registerHouseholdRoutes` and `registerScoped`; remove the `void deps;` line; after the auth registration add:
```ts
  registerHouseholdRoutes(app, deps);
  await registerScoped(app, deps);
```

- [ ] **Step 5: Run — expect pass; commit**

Run: `pnpm --filter @plantry/backend test && pnpm --filter @plantry/backend typecheck`
```bash
git add -A
git commit -m "feat(backend): households, scoped membership plugin, member roles"
```

---

### Task 5: Invites

**Files:**
- Create: `apps/backend/src/households/invites.ts`
- Modify: `apps/backend/src/scoped/index.ts`, `apps/backend/src/app.ts`
- Test: `apps/backend/src/households/invites.test.ts`

**Interfaces:**
- Consumes: scoped plugin, `AppError`, `hashSid` (reused as the generic SHA-256 helper), shared `InviteDto`.
- Produces: `POST /api/households/:hid/invites → { data: InviteDto }`; `POST /api/invites/:token/accept → { data: HouseholdSummary }`; `registerInviteCreateRoute(s, deps)`, `registerInviteAcceptRoute(app, deps)`.

- [ ] **Step 1: Failing test**

`apps/backend/src/households/invites.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);

const tokenOf = (url: string) => url.split('/invite/')[1]!;

describe('invites', () => {
  it('any member creates a 7-day link; accepting joins as member', async () => {
    const owner = await ctx.user(); const m = await ctx.user(); const guest = await ctx.user();
    const hid = await ctx.household(owner); await ctx.addMember(hid, m);
    const inv = await ctx.call(m, 'POST', `/api/households/${hid}/invites`);
    expect(inv.status).toBe(200);
    expect(inv.body.data.url).toMatch(/^http:\/\/localhost:5173\/invite\/.{43,}$/);
    const days = (new Date(inv.body.data.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9); expect(days).toBeLessThan(7.1);

    const acc = await ctx.call(guest, 'POST', `/api/invites/${tokenOf(inv.body.data.url)}/accept`);
    expect(acc.status).toBe(200);
    expect(acc.body.data).toMatchObject({ id: hid, role: 'member' });
  });

  it('is single-use, but idempotent for someone already a member', async () => {
    const owner = await ctx.user(); const g1 = await ctx.user(); const g2 = await ctx.user();
    const hid = await ctx.household(owner);
    const token = tokenOf((await ctx.call(owner, 'POST', `/api/households/${hid}/invites`)).body.data.url);
    expect((await ctx.call(g1, 'POST', `/api/invites/${token}/accept`)).status).toBe(200);
    expect((await ctx.call(g1, 'POST', `/api/invites/${token}/accept`)).status).toBe(200);
    const second = await ctx.call(g2, 'POST', `/api/invites/${token}/accept`);
    expect(second.status).toBe(410);
    expect(second.body.error.code).toBe('invite_invalid');
  });

  it('an existing member accepting does not consume the invite', async () => {
    const owner = await ctx.user(); const guest = await ctx.user();
    const hid = await ctx.household(owner);
    const token = tokenOf((await ctx.call(owner, 'POST', `/api/households/${hid}/invites`)).body.data.url);
    expect((await ctx.call(owner, 'POST', `/api/invites/${token}/accept`)).body.data.role).toBe('owner');
    expect((await ctx.call(guest, 'POST', `/api/invites/${token}/accept`)).status).toBe(200);
  });

  it('expired and unknown tokens are 410', async () => {
    const owner = await ctx.user(); const guest = await ctx.user();
    const hid = await ctx.household(owner);
    const token = tokenOf((await ctx.call(owner, 'POST', `/api/households/${hid}/invites`)).body.data.url);
    await ctx.prisma.householdInvite.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await ctx.call(guest, 'POST', `/api/invites/${token}/accept`)).status).toBe(410);
    expect((await ctx.call(guest, 'POST', '/api/invites/nope/accept')).status).toBe(410);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement**

`apps/backend/src/households/invites.ts`:
```ts
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { HouseholdSummary, InviteDto } from '@plantry/shared';
import { hashSid } from '../auth/session.js';
import type { Deps } from '../deps.js';
import { AppError } from '../errors.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const invalid = () => new AppError(410, 'invite_invalid', 'This invite is no longer valid');

export function registerInviteCreateRoute(s: FastifyInstance, deps: Deps): void {
  s.post('/invites', async (req) => {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await deps.prisma.householdInvite.create({
      data: { tokenHash: hashSid(token), householdId: req.household!.id, createdBy: req.user!.sub, expiresAt },
    });
    const data: InviteDto = { url: `${deps.frontendOrigin}/invite/${token}`, expiresAt: expiresAt.toISOString() };
    return { data };
  });
}

export function registerInviteAcceptRoute(app: FastifyInstance, deps: Deps): void {
  app.post<{ Params: { token: string } }>('/api/invites/:token/accept', { preHandler: app.requireAuth }, async (req) => {
    const sub = req.user!.sub;
    const data = await deps.prisma.$transaction(async (tx): Promise<HouseholdSummary> => {
      const invite = await tx.householdInvite.findUnique({
        where: { tokenHash: hashSid(req.params.token) }, include: { household: true },
      });
      if (!invite || invite.expiresAt.getTime() <= Date.now()) throw invalid();
      const existing = await tx.householdMember.findUnique({
        where: { householdId_userSub: { householdId: invite.householdId, userSub: sub } },
      });
      if (existing) return { id: invite.householdId, name: invite.household.name, role: existing.role };
      if (invite.acceptedBy) throw invalid();
      await tx.householdMember.create({ data: { householdId: invite.householdId, userSub: sub, role: 'member' } });
      await tx.householdInvite.update({ where: { id: invite.id }, data: { acceptedBy: sub, acceptedAt: new Date() } });
      return { id: invite.householdId, name: invite.household.name, role: 'member' };
    });
    return { data };
  });
}
```

Wire: in `scoped/index.ts` import and call `registerInviteCreateRoute(s, deps);` after `registerMemberRoutes`. In `app.ts` import and call `registerInviteAcceptRoute(app, deps);` after `registerHouseholdRoutes`.

- [ ] **Step 3: Run — expect pass; commit**

Run: `pnpm --filter @plantry/backend test`
```bash
git add -A
git commit -m "feat(backend): single-use household invite links"
```
