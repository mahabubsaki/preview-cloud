# Stage 1: Prune the monorepo for the server workspace
FROM oven/bun AS pruner
RUN bun add -g turbo@~2.9.8
WORKDIR /app
COPY . .
RUN turbo prune @github-app/server --docker

# Stage 2: Install dependencies using pruned lockfile
FROM oven/bun AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/bun.lock ./bun.lock
RUN bun install

# Stage 3: Compile the Server into a standalone binary
FROM installer AS builder
COPY --from=pruner /app/out/full/ .

# Detect architecture and compile the entry point
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ]; then TARGET="bun-linux-arm64"; else TARGET="bun-linux-x64"; fi && \
    bun build \
    --compile \
    --minify-whitespace \
    --minify-syntax \
    --target $TARGET \
    --outfile /app/server \
    apps/server/src/main.ts

# Stage 4: Production runner — distroless for minimal attack surface & size
FROM gcr.io/distroless/base AS runner
WORKDIR /app
COPY --from=builder /app/server server
# Copy migrations for potential bootstrap migration
COPY --from=builder /app/packages/core/db/drizzle /app/drizzle

EXPOSE 3001
CMD ["./server"]
