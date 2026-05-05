FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

# ── Dependencies ──────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --filter web...

# ── Build shared ─────────────────────────────────────────────────
FROM deps AS shared-build
WORKDIR /app
COPY packages/shared ./packages/shared
RUN pnpm --filter shared build

# ── Build web ────────────────────────────────────────────────────
FROM shared-build AS web-build
WORKDIR /app
COPY apps/web ./apps/web
# Public URLs are baked into the Nuxt client bundle at build time.
# Override via build args from docker-compose.
ARG NUXT_PUBLIC_API_BASE=/api
ARG NUXT_PUBLIC_WS_BASE=/ws
ENV NUXT_PUBLIC_API_BASE=$NUXT_PUBLIC_API_BASE
ENV NUXT_PUBLIC_WS_BASE=$NUXT_PUBLIC_WS_BASE
RUN pnpm --filter web build

# ── Runtime image ────────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app

COPY --from=web-build /app/apps/web/.output ./.output
COPY --from=web-build /app/apps/web/package.json .

EXPOSE 3000

ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production

CMD ["node", ".output/server/index.mjs"]
