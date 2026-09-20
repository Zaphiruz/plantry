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
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./
COPY --from=build /repo/apps/backend/dist apps/backend/dist
COPY --from=build /repo/apps/backend/package.json apps/backend/
COPY --from=build /repo/apps/backend/node_modules apps/backend/node_modules
COPY --from=build /repo/apps/backend/prisma apps/backend/prisma
COPY apps/backend/entrypoint.mjs apps/backend/entrypoint.mjs
EXPOSE 3000
CMD ["node", "apps/backend/entrypoint.mjs"]
