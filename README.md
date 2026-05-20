<p align="center">
  <strong>✦ PREVIEW.CLOUD</strong>
</p>

<p align="center">
  A self-hosted preview deployment platform — like Vercel, but on your own infrastructure.<br/>
  Push code → Auto-detect framework → Build Docker image → Deploy preview URL.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/runtime-Bun-f472b6?style=flat-square" />
  <img src="https://img.shields.io/badge/framework-Effect--TS-8b5cf6?style=flat-square" />
  <img src="https://img.shields.io/badge/queue-BullMQ-ef4444?style=flat-square" />
  <img src="https://img.shields.io/badge/dashboard-Next.js_16-000?style=flat-square" />
  <img src="https://img.shields.io/badge/proxy-Traefik_v3-24a1c1?style=flat-square" />
</p>

---

## 📖 What is Preview.Cloud?

**Preview.Cloud** is a custom-built, ultra-lightweight Continuous Integration and Deployment (CI/CD) platform designed specifically to generate **ephemeral preview environments** for every Pull Request or branch push.

While traditional platforms (like Vercel, Netlify, or self-hosted solutions like Coolify/Dokku) perform heavy lifting (building Next.js apps, compiling Vite, running `npm install`) on their own servers, **Preview.Cloud takes a radically different approach to minimize your server costs.**

It deliberately **offloads the most resource-intensive phase—the Docker build—to GitHub Actions**. 
GitHub Actions provides generous, free, and highly scalable runners. Preview.Cloud triggers a build on GitHub Actions, streams the logs back to your dashboard in real-time via Server-Sent Events (SSE), pushes the compiled Docker image to the GitHub Container Registry (GHCR), and then simply instructs your own server to pull and run the lightweight compiled container. 

This hybrid architecture means your self-hosted Virtual Private Server (VPS) only needs enough RAM to run the control plane (which is minimal) and the final, optimized production containers.

### Key Features
- **Zero-Config Framework Detection**: Automatically detects Next.js, Vite, Astro, Nuxt, Remix, SvelteKit, and more.
- **Micro-Footprint Architecture**: Built with Bun and compiled into standalone binaries. The core services run on a fraction of the RAM required by traditional orchestration platforms.
- **Discord Approval Workflow**: Get a Discord notification for every push. Approve or cancel the build with interactive buttons directly from Discord.
- **Real-Time Log Streaming**: Native integration between GitHub Actions and your dashboard to stream build logs in real-time, just like Vercel.
- **Automatic Teardown**: Cleans up containers and resources automatically when a branch is deleted or a preview is dismissed.

## 🌟 In-Depth Technical Features

Preview.Cloud is built with a sophisticated, highly fault-tolerant architecture utilizing **Effect-TS** and **BullMQ**:

### 1. Hybrid Build Engine (Local + GitHub Actions)
Instead of consuming gigabytes of RAM on your self-hosted server to compile Next.js or Vite apps, Preview.Cloud's Worker intelligently offloads the build process. It dynamically triggers a `workflow_dispatch` on a GitHub Action, injecting your project's environment variables as build arguments. The GitHub Action does the heavy lifting, generates the Docker image, pushes it to GHCR, and notifies your server via an internal `/api/build-complete` callback.

### 2. Zero-Config Framework & Monorepo Detection
The Build Orchestrator heuristically scans the cloned repository to detect the underlying framework. It supports Next.js, Vite, Nuxt, Astro, SvelteKit, and standard Node/Bun runtimes. For monorepos (identified via `turbo.json` or `pnpm-workspace.yaml`), it runs isolated builds using tools like `turbo prune`, dynamically generating optimized multi-stage Dockerfiles without any manual configuration.

### 3. Real-Time Log Streaming via SSE
You don't lose visibility when builds are offloaded. The GitHub Action streams log lines in real-time back to your server's `/api/build-log` endpoint. The server publishes these logs into a Redis PubSub channel (`logs:<commitSha>`), which the Next.js Dashboard subscribes to via Server-Sent Events (SSE). This provides a native, Vercel-like real-time logging experience.

### 4. Resilient Queue-Based Architecture
Tasks are decoupled across multiple specialized BullMQ queues:
- **`DEPLOYMENT_QUEUE`**: Handles webhook ingestion and Discord notifications.
- **`BUILD_QUEUE`**: Manages the multi-step build process (Environment fetch -> Repository Checkout -> Framework Detection -> GitHub Actions Trigger).
- **`NOTIFY_QUEUE`**: Broadcasts database state changes and updates Discord embeds upon success/failure.
- **`DELETE_QUEUE`**: Automatically force-removes old Docker containers and releases reserved local ports when a branch is deleted or a preview is dismissed.

### 5. Automated Resource Teardown
Preview.Cloud keeps your server clean. The orchestrator actively monitors GitHub for `delete` branch webhooks. It automatically cancels active GitHub Action runs for that branch (using `gh run cancel`), releases reserved ports in Redis, and forcefully removes stale preview containers from the Docker network.

### 6. Dynamic Traefik Routing & Port Management
Depending on your `DEPLOYMENT_MODE`:
- In **Development**, it automatically finds an open port within the `PREVIEW_PORT_MIN/MAX` range, reserves it via Redis, and launches the container exposed on that local port.
- In **Production**, it attaches the container to the `preview-net` Docker network and dynamically injects Traefik labels, automatically routing traffic (e.g., `https://projectId-branch.preview.yourdomain.com`) directly to the container with zero downtime.

### 7. Secure Webhook & API Infrastructure
The Elysia backend acts as a strict gatekeeper. GitHub webhooks are verified using `x-hub-signature-256` HMAC validation. The internal callback endpoints (used by GitHub Actions to report success or stream logs) are secured with an `x-callback-secret`, preventing unauthorized execution or log spoofing. Environment variables are stored natively in Postgres and dynamically injected into builds as `--build-arg` and runtime as `--env-file`.

---

## How It Works

```text
GitHub Push → Webhook → Discord Approval → GitHub Actions (Build) → Deploy Container → Preview URL
```

1. **GitHub App** receives push/delete webhooks
2. **Server** validates the signature, creates a deployment record, and queues a job
3. **Discord Bot** sends an approval embed with ✅/❌ buttons
4. **Build Worker** triggers a GitHub Action to clone, detect the framework, build, and push the image to a container registry (GHCR/Docker Hub), significantly reducing local server RAM usage.
5. **Build Worker** pulls the built image and launches a preview container.
6. **Dashboard** shows real-time build logs streamed directly from GitHub Actions via SSE, and lets you manage envs, rebuild, or teardown.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        MONOREPO                             │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Dashboard   │  │    Server    │  │      Worker      │  │
│  │  (Next.js)    │  │  (Elysia)   │  │  (BullMQ + Bun)  │  │
│  │   Port 3000   │  │  Port 3001  │  │                  │  │
│  └───────┬───────┘  └──────┬──────┘  └────────┬─────────┘  │
│          │                 │                   │            │
│  ┌───────┴─────────────────┴───────────────────┴─────────┐  │
│  │              packages/core (shared)                    │  │
│  │  • DB Schema (Drizzle)  • Queue Schemas (Zod)         │  │
│  │  • Crypto (AES-256-GCM) • Type Definitions            │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │     Infrastructure      │
              │  PostgreSQL │ Redis     │
              │  Traefik    │ Docker    │
              └─────────────────────────┘
```

## Supported Frameworks

The GitHub Action build worker auto-detects your framework and generates an optimized Dockerfile:

| Framework | Detection | Build Strategy |
|-----------|-----------|----------------|
| **Next.js** | `next` in deps | Standalone output + multi-stage |
| **Vite** | `vite` in deps | Static build → `serve` |
| **Astro** | `astro` in deps | Static build → `serve` |
| **Nuxt** | `nuxt` in deps | Static build → `serve` |
| **Remix** | `@remix-run/*` in deps | Static build → `serve` |
| **SvelteKit** | `@sveltejs/kit` in deps | Static build → `serve` |
| **Hono / Express / Fastify / NestJS** | Framework in deps | Node/Bun runtime |
| **Monorepo** | `turbo.json` / `nx.json` / `pnpm-workspace.yaml` | Turbo/Nx build filter |

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- [Docker](https://docs.docker.com/get-docker/) + Docker Compose
- A [GitHub App](https://docs.github.com/en/developers/apps) (for webhook integration)
- A [Discord Bot](https://discord.com/developers/applications) (optional, for approval flow)

### 1. Clone & Install

```bash
git clone https://github.com/mahabubsaki/preview-cloud-ph.git
cd preview-cloud-ph
bun install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values — see [Configuration Reference](#configuration-reference) below.

### 3. Create the Docker Network

```bash
docker network create preview-net
```

### 4. Set Up the Database

```bash
docker compose up -d postgres redis
cd packages/core
bunx drizzle-kit push
```

### 5. Start Everything

```bash
# Start all services
docker compose up -d

# Or for local development (server + worker + dashboard individually):
bun run dev
```

### 6. Expose Webhooks (Local Dev)

```bash
# Use the consolidated proxy script for webhooks, builds, and logs
bun proxies
```

This starts [smee.io](https://smee.io) tunnels to forward GitHub webhooks and build events to your local server.

---

## Project Structure

```
preview-cloud-ph/
├── apps/
│   ├── dashboard/          # Next.js 16 — deployment management UI
│   │   ├── src/
│   │   │   ├── app/        # Pages (App Router)
│   │   │   ├── components/ # React components
│   │   │   └── lib/        # Effect runtime & services
│   │   └── Dockerfile
│   ├── server/             # Elysia (Effect-TS) — API + webhook handler
│   │   ├── src/
│   │   │   ├── routes/     # Webhook + REST API handlers
│   │   │   ├── services/   # Effect service layers
│   │   │   └── workers/    # Notification queue processor
│   │   └── Dockerfile
│   └── worker/             # BullMQ worker — build orchestrator
│       ├── src/
│       │   ├── orchestrator/ # Framework detection + Dockerfile generation
│       │   ├── services/     # Effect service layers
│       │   └── workers/      # Build, Delete, Cleanup, Discord workers
│       └── Dockerfile
├── packages/
│   └── core/               # Shared package
│       ├── db/             # Drizzle schema + client
│       ├── queue/          # Zod job schemas
│       ├── crypto.ts       # AES-256-GCM encryption
│       └── types/          # Shared TypeScript types
├── docker-compose.yml      # Full stack orchestration
├── turbo.json              # Turborepo configuration
└── .env.example            # Environment template
```

## Configuration Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `REDIS_URL` | ✅ | `redis://localhost:6379` | Redis connection string |
| `ENCRYPTION_KEY` | ✅ | Dev fallback | 64-char hex string for AES-256-GCM |
| `GITHUB_APP_ID` | ✅ | — | GitHub App ID |
| `GITHUB_PRIVATE_KEY` | ✅ | — | GitHub App private key (PEM) |
| `GITHUB_WEBHOOK_SECRET` | ✅ | — | Webhook signature secret |
| `GITHUB_TOKEN` | ⚠️ | — | PAT for private repo cloning |
| `DISCORD_BOT_TOKEN` | ❌ | — | Discord bot token (enables approval flow) |
| `DISCORD_CHANNEL_ID` | ❌ | — | Channel for deployment notifications |
| `PREVIEW_DOMAIN` | ⚠️ | `preview.yourdomain.com` | Base domain for preview URLs |
| `PREVIEW_PORT_MIN` | ❌ | `5001` | Port range start (dev mode) |
| `PREVIEW_PORT_MAX` | ❌ | `6000` | Port range end (dev mode) |
| `DEPLOYMENT_MODE` | ❌ | `development` | `production` enables Traefik routing |
| `BUILD_CONCURRENCY` | ❌ | `2` | Max parallel builds |
| `DELETE_CONCURRENCY` | ❌ | `5` | Max parallel teardowns |
| `PREVIEW_MEMORY_LIMIT` | ❌ | `256m` | Container memory limit |
| `PREVIEW_CPU_LIMIT` | ❌ | `0.5` | Container CPU limit |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/deployments` | List all deployments (grouped by project+branch) |
| `GET` | `/api/projects` | List all projects |
| `GET` | `/api/projects/:id` | Get project details |
| `GET` | `/api/projects/:id/branches` | Get branches for a project |
| `GET` | `/api/projects/:id/envs` | Get environment variables (decrypted) |
| `POST` | `/webhooks` | GitHub webhook receiver |
| `POST` | `/api/build-complete` | Internal callback for GitHub Actions build completion |
| `POST` | `/api/build-log` | Internal endpoint for streaming real-time log lines |
| `GET` | `/api/events` | SSE stream for real-time deployment updates |
| `GET` | `/api/docs` | OpenAPI/Swagger documentation |

## Queue Architecture

```
DEPLOYMENT_QUEUE ──→ Discord Worker (approval embed)
                         │
                    ✅ Approved
                         │
                         ▼
BUILD_QUEUE ────────→ Build Worker ──→ GitHub Actions (Build & Push)
                         │                  │
                    ┌────┴────┐             │
                    ▼         ▼             │
               Success    Failure ◄─────────┘
                    │         │
                    ▼         ▼
NOTIFY_QUEUE ──→ Notify Worker (DB update + SSE broadcast + Discord status)

DELETE_QUEUE ──→ Delete Worker (container teardown + port release)
```

## Discord Integration

When configured, the Discord bot provides:

- **🚀 Approval Flow** — Push events create an embed with Deploy/Cancel buttons
- **⌛→✅/❌ Status Updates** — The approval message updates in real-time as the build progresses
- **📊 Build Summary** — On success, a detailed embed shows the preview URL, build time, framework, repo, and branch

## Development

```bash
# Type checking
bun run check-types

# Format code
bun run format

# Database migrations
cd packages/core && bunx drizzle-kit push

# View build logs
docker compose logs -f worker

# Rebuild specific service
docker compose up -d --build server worker
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | [Bun](https://bun.sh) |
| **Type System** | TypeScript 6 (strict mode) |
| **Effect System** | [Effect-TS](https://effect.website) — services, error handling, concurrency |
| **API Framework** | [Elysia](https://elysiajs.com) + Eden Treaty |
| **Dashboard** | [Next.js 16](https://nextjs.org) (App Router) |
| **Database** | PostgreSQL 16 + [Drizzle ORM](https://orm.drizzle.team) |
| **Queue** | [BullMQ](https://docs.bullmq.io) + Redis |
| **Validation** | [Zod](https://zod.dev) |
| **Containerization** | Docker + Traefik v3 |
| **Bot** | [Discord.js](https://discord.js.org) |
| **Build Tool** | [Turborepo](https://turbo.build) |
| **Security** | AES-256-GCM encryption, HMAC webhook verification |

## License

MIT
