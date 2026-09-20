# Plantry

Plantry is a household inventory and shopping app: track pantry stock across one or more households, get notified when items run low, build a shopping list from what's low, and restock with a tap. It's a pnpm TypeScript monorepo — `packages/shared` (zod schemas, DTO types, constants), `apps/backend` (Fastify 5 + Prisma 5 + PostgreSQL), and `apps/frontend` (React + Redux Toolkit, installable PWA with push notifications).

See the [handoff spec](docs/Household%20Inventory%20App%20—%20Handoff%20Spec.md) for product requirements and the [implementation plan](docs/superpowers/plans/2026-09-19-plantry.md) for how it was built. Operational/deploy details live in [OPERATIONS.md](OPERATIONS.md).

## Dev quick-start

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm --filter @plantry/backend prisma migrate dev
pnpm --filter @plantry/backend test:db:setup
pnpm dev     # http://localhost:5173/api/auth/dev-login?sub=me&name=Me&admin=1
pnpm test
```
