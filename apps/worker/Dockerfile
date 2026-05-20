# Stage 1: Prune the monorepo for the worker workspace
FROM oven/bun AS pruner
RUN bun add -g turbo@~2.9.8
WORKDIR /app
COPY . .
RUN turbo prune @github-app/worker --docker

# Stage 2: Install dependencies using pruned lockfile
FROM oven/bun AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/bun.lock ./bun.lock
RUN bun install

# Stage 3: Compile the Worker into a standalone binary
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
    --outfile /app/worker \
    apps/worker/src/main.ts

# Stage 4: Production runner — Debian (glibc compatible + easy CLI tools)
FROM debian:bookworm-slim AS runner
WORKDIR /app

# Install required CLI tools for build orchestration
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ca-certificates \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI
RUN apt-get update && apt-get install -y docker.io && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/worker worker
# Copy migrations for potential bootstrap migration
COPY --from=builder /app/packages/core/db/drizzle /app/drizzle

# Ensure the binary is executable
RUN chmod +x /app/worker

CMD ["./worker"]
