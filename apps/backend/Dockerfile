FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/backend apps/backend
RUN pnpm --filter @plantry/backend exec prisma generate
RUN pnpm --filter @plantry/backend build

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl tzdata
WORKDIR /repo
ENV NODE_ENV=production
# Owned by `node`: the Prisma CLI refuses to run unless its engines directory is writable by
# the current user, and `prisma migrate deploy` runs from this image during deploys.
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/package.json ./
COPY --from=build --chown=node:node /repo/apps/backend/dist apps/backend/dist
COPY --from=build --chown=node:node /repo/apps/backend/package.json apps/backend/
COPY --from=build --chown=node:node /repo/apps/backend/node_modules apps/backend/node_modules
COPY --from=build --chown=node:node /repo/apps/backend/prisma apps/backend/prisma
COPY --chown=node:node apps/backend/entrypoint.mjs apps/backend/env-filter.mjs apps/backend/
USER node
EXPOSE 3000
# Liveness for Docker/compose. Uses node's built-in fetch (no curl in this image) and only
# hits /health, which is rate-limit allow-listed and touches nothing. /api/ready (which does
# probe the database) is what the deploy workflow checks.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/backend/entrypoint.mjs"]
