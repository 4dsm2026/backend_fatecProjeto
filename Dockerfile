# pnpm fixado: o pnpm 11 exige Node 22. O pnpm-workspace.yaml traz o allowBuilds,
# sem ele o pnpm recusa os builds nativos (prisma, argon2).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm i -g pnpm@11.20.0 && pnpm i --frozen-lockfile


FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build


FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json

RUN mkdir -p /app/uploads && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3333

# 127.0.0.1 e não localhost: no Alpine, localhost resolve para IPv6 e o servidor escuta só IPv4.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3333/health || exit 1

CMD ["node", "dist/server.js"]
