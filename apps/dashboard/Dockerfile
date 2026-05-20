FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/core/package.json ./packages/core/package.json
COPY apps/server/package.json ./apps/server/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/dashboard/package.json ./apps/dashboard/package.json
RUN bun install
COPY packages ./packages
COPY apps ./apps
COPY tsconfig.json ./
RUN cd apps/dashboard && bun run build

FROM oven/bun:1-alpine AS runner
WORKDIR /app
COPY --from=builder /app ./

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Change to the dashboard directory to run
WORKDIR /app/apps/dashboard
CMD ["bun", "run", "start"]
