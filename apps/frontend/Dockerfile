FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/frontend/package.json apps/frontend/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/frontend apps/frontend
RUN pnpm --filter @plantry/frontend exec vite build

FROM caddy:2-alpine AS runtime
COPY apps/frontend/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/frontend/dist /srv
EXPOSE 80
