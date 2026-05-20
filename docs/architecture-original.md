# GitHub App — Preview Deployment System
## Architecture Document

---

## Table of Contents

1. [Overview](#overview)
2. [Problem Statement](#problem-statement)
3. [System Design Goals](#system-design-goals)
4. [High-Level Architecture](#high-level-architecture)
5. [Full Deployment Flow](#full-deployment-flow)
6. [Components](#components)
   - [GitHub App Server](#1-@github-app/server)
   - [Discord Bot / Webhook](#2-discord-bot--webhook)
   - [Deployment Orchestrator](#3-deployment-orchestrator)
   - [ENV Server](#4-env-server)
   - [ENV Management Dashboard](#5-env-management-dashboard)
   - [Docker Infrastructure](#6-docker-infrastructure)
   - [Preview URL Router](#7-preview-url-router)
7. [Database Schema](#database-schema)
8. [API Contracts](#api-contracts)
9. [Security Considerations](#security-considerations)
10. [Open Questions for Team Discussion](#open-questions-for-team-discussion)

---

## Overview

This system is a self-hosted GitHub App that provides Vercel-style preview deployments for company repositories. When a developer pushes code to a branch or opens a pull request, a Discord message is sent asking for deployment approval. If approved, the system builds and deploys both the frontend and backend in separate Docker containers, fetches environment variables from a centralized ENV server, and posts a live preview URL back to GitHub.

---

## Problem Statement

Our company repositories are not connected to Vercel. As a result, developers have no way to get preview deployment links when pushing to branches or opening pull requests. This slows down code review and testing.

**Goal:** Build a GitHub App that replicates Vercel-style preview deployments using our own Docker infrastructure, with centralized ENV management and Discord-based deployment approval.

---

## System Design Goals

- Deployments triggered by GitHub push and pull request events
- Manual approval via Discord before any deployment happens
- Frontend and backend deployed as separate Docker containers per branch
- Environment variables fetched at runtime from a centralized ENV server
- Preview URLs posted back to GitHub as PR comments
- Deployment lifetime is configurable per project
- System supports 5–10 concurrent preview deployments

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Developer                                │
│                    git push / PR opened                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      GitHub                                     │
│               Sends webhook event to GitHub App                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   GitHub App Server                             │
│  - Validates webhook signature                                  │
│  - Identifies repo → Project ID mapping                        │
│  - Sends approval request to Discord                           │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Discord Bot                                   │
│  - Posts message: "Deploy branch X?" with ✅ Yes / ❌ No       │
│  - Waits for team member to click                               │
└──────────┬────────────────────────────────────────┬────────────┘
           │ Yes clicked                            │ No clicked
           ▼                                        ▼
┌──────────────────────┐                  ┌─────────────────────┐
│ Deployment           │                  │ Deployment Cancelled │
│ Orchestrator         │                  │ Discord notified     │
└──────────┬───────────┘                  └─────────────────────┘
           │
           ├──── Fetches ENVs from ENV Server (by Project ID)
           │
           ├──── Builds Frontend Docker Image
           │         └── Runs Frontend Container (port assigned)
           │
           └──── Builds Backend Docker Image
                     └── Runs Backend Container (port assigned)
                                │
                                ▼
                    ┌───────────────────────┐
                    │   Preview URL Router  │
                    │  (Nginx / Traefik)    │
                    │                       │
                    │  frontend-branch.     │
                    │  preview.company.com  │
                    │  backend-branch.      │
                    │  preview.company.com  │
                    └───────────┬───────────┘
                                │
                                ▼
                    Preview URLs posted to GitHub
                    as PR comment / commit status
```

---

## Full Deployment Flow

### Step-by-step

1. **Developer pushes** code to a branch or opens a pull request on a connected repo.

2. **GitHub sends a webhook** event (`push` or `pull_request`) to the GitHub App Server.

3. **GitHub App Server:**
   - Validates the webhook signature (using `GITHUB_WEBHOOK_SECRET`)
   - Looks up the repo in the database to find its `Project ID`
   - Sends an approval request to the Discord Bot

4. **Discord Bot posts a message** in the configured channel:
   ```
   🚀 Deploy request for repo: my-company/frontend
   Branch: feature/login-page
   Triggered by: developer@company.com
   
   Should we deploy this?
   ✅ Yes    ❌ No
   ```

5. **Team member clicks Yes or No:**
   - **No** → Discord posts "Deployment cancelled" and the flow stops
   - **Yes** → Discord notifies the Deployment Orchestrator to proceed

6. **Deployment Orchestrator:**
   - Calls the ENV Server API with the `Project ID` to fetch the environment variables
   - Clones or fetches the branch code from GitHub
   - Builds the frontend Docker image
   - Builds the backend Docker image
   - Runs both containers with the fetched ENVs injected
   - Assigns unique ports or subdomain routes to each container

7. **Preview URL Router (Nginx/Traefik):**
   - Maps the running containers to readable preview URLs:
     - `frontend-feature-login.preview.company.com`
     - `backend-feature-login.preview.company.com`

8. **GitHub App Server posts back to GitHub:**
   - Adds a comment to the PR with both preview URLs
   - Updates the commit status to `success` with the preview link

9. **Deployment lifetime:**
   - Configurable per project from the ENV Management Dashboard
   - Options: keep alive until branch deleted, auto-delete after N hours/days, or manual teardown

---

## Components

### 1. GitHub App Server

**Role:** The entry point. Receives GitHub events and coordinates the rest of the system.

**Responsibilities:**
- Register as a GitHub App and install on company repos
- Receive and validate webhook events (`push`, `pull_request`)
- Map repo → Project ID using database
- Notify Discord Bot for approval
- Post preview URLs back to GitHub as PR comments and commit statuses

**GitHub App Permissions:**
| Permission | Level |
|---|---|
| Contents | Read |
| Pull Requests | Write |
| Commit Statuses | Write |
| Metadata | Read |

**Webhook Events:**
- `push`
- `pull_request` (types: opened, synchronize, reopened)

**Tech Stack:**
- Node.js with `@octokit/app` and `@octokit/webhooks`
- Or Python with `PyGithub` + `flask`/`fastapi`

**Key Environment Variables:**
```
GITHUB_APP_ID
GITHUB_PRIVATE_KEY
GITHUB_WEBHOOK_SECRET
DISCORD_BOT_TOKEN
ORCHESTRATOR_API_URL
DB_CONNECTION_STRING
```

---

### 2. Discord Bot / Webhook

**Role:** Human-in-the-loop approval gate before any deployment happens.

**Responsibilities:**
- Receive deployment request from GitHub App Server
- Post a formatted approval message with Yes / No buttons
- On Yes: call Deployment Orchestrator API to trigger deployment
- On No: post cancellation confirmation

**Message Format:**
```
🚀 New Deployment Request
──────────────────────────
Repo:    my-company/frontend
Branch:  feature/login-page
Commit:  a3f9c12 - "Add login form"
Author:  dev@company.com
──────────────────────────
[ ✅ Deploy ]   [ ❌ Cancel ]
```

**Tech Stack:**
- Discord.js (Node.js) for interactive button support
- Or Discord Interactions Webhook (simpler, no persistent bot needed)

**Key Environment Variables:**
```
DISCORD_BOT_TOKEN
DISCORD_CHANNEL_ID
ORCHESTRATOR_API_URL
ORCHESTRATOR_API_SECRET
```

---

### 3. Deployment Orchestrator

**Role:** The engine that actually builds and deploys Docker containers for each branch.

**Responsibilities:**
- Receive deployment trigger from Discord Bot
- Fetch ENVs from ENV Server using Project ID
- Clone or pull the branch code from GitHub
- Build frontend and backend Docker images
- Run containers and assign preview URLs
- Report deployment status back to GitHub App Server
- Handle deployment teardown based on configured lifetime

**Deployment Trigger API:**
```
POST /deploy
{
  "project_id": "abc123",
  "repo": "my-company/frontend",
  "branch": "feature/login-page",
  "commit_sha": "a3f9c12",
  "pr_number": 42
}
```

**Docker Strategy:**
- One Docker Compose file per deployment (dynamically generated)
- Frontend container and backend container run separately
- Each deployment gets a unique network namespace
- Ports are dynamically assigned and registered with the URL Router

**Deployment Lifecycle:**
```
PENDING → BUILDING → RUNNING → EXPIRED / STOPPED
```

**Tech Stack:**
- Node.js or Python
- Docker SDK (`dockerode` for Node, `docker` Python SDK)
- Or shell commands via `child_process` / `subprocess`

**Key Environment Variables:**
```
ENV_SERVER_URL
ENV_SERVER_API_KEY
GITHUB_TOKEN
DOCKER_HOST
ROUTER_API_URL
```

---

### 4. ENV Server

**Role:** Centralized, secure store for all project environment variables.

**Responsibilities:**
- Store ENVs per project (identified by Project ID)
- Expose a secure internal API for the Deployment Orchestrator to fetch ENVs
- Never expose ENVs directly to the frontend or public internet
- Support multiple environments per project if needed (e.g., preview, staging, production)

**API:**
```
GET /envs/:project_id
Authorization: Bearer <ORCHESTRATOR_API_KEY>

Response:
{
  "project_id": "abc123",
  "envs": {
    "DATABASE_URL": "postgres://...",
    "API_KEY": "secret123",
    "NODE_ENV": "preview"
  }
}
```

**Security Rules:**
- Only accessible from internal network (not public)
- API key required for every request
- Logs all access with timestamp and requesting service

**Tech Stack:**
- Simple REST API (Node.js / Python / Go)
- Database: PostgreSQL or encrypted file store (e.g., HashiCorp Vault for advanced use)

---

### 5. ENV Management Dashboard

**Role:** A web UI for team members to manage environment variables and project configurations.

**Responsibilities:**
- Create and manage Projects (each project maps to one or more repos)
- Add, edit, delete environment variables per project
- Configure deployment settings per project:
  - Deployment lifetime (e.g., keep alive, auto-delete after 24h, 7 days)
  - Which branches should trigger deployment notifications
  - Frontend and backend Dockerfile paths
- View active deployments and their preview URLs
- Manually trigger teardown of a deployment

**Key Pages:**
| Page | Description |
|---|---|
| Projects | List all projects and their linked repos |
| Project Settings | Configure ENVs, deployment lifetime, Dockerfile paths |
| Active Deployments | See all running previews with URLs and status |
| Deployment Logs | View build and runtime logs per deployment |

**Tech Stack:**
- Next.js or React frontend
- Connects to ENV Server and Orchestrator APIs
- Auth: Simple team login (email + password or SSO)

---

### 6. Docker Infrastructure

**Role:** The hosting layer that runs all preview deployments as containers.

**Responsibilities:**
- Run frontend and backend containers per branch deployment
- Isolate deployments from each other using Docker networks
- Manage container lifecycle (start, stop, remove)
- Expose container ports to the Preview URL Router

**Container Strategy:**

Each deployment creates two containers:

```
deployment-abc123-frontend   (e.g., Next.js / React app)
deployment-abc123-backend    (e.g., Node.js / Django API)
```

Both containers share a Docker network:
```
network: preview-abc123
```

ENVs are passed at container runtime:
```bash
docker run \
  --name deployment-abc123-frontend \
  --network preview-abc123 \
  --env-file /tmp/envs-abc123.env \
  -p 3001:3000 \
  my-company/frontend:feature-login-page
```

**Infrastructure Notes:**
- VPS or cloud server (your senior to set up)
- Docker and Docker Compose installed
- Sufficient RAM and CPU for 5–10 concurrent containers
- Shared volume or registry for Docker images (optional)

---

### 7. Preview URL Router

**Role:** Maps running Docker containers to readable preview URLs.

**Responsibilities:**
- Dynamically register new preview routes when a deployment starts
- Route incoming requests to the correct container
- Remove routes when a deployment is torn down

**URL Pattern:**
```
Frontend: https://frontend-{branch-slug}.preview.company.com
Backend:  https://backend-{branch-slug}.preview.company.com
```

**Example:**
```
Branch: feature/login-page
Frontend URL: https://frontend-feature-login-page.preview.company.com
Backend URL:  https://backend-feature-login-page.preview.company.com
```

**Tech Stack Options:**
- **Traefik** (recommended) — supports dynamic Docker routing out of the box via labels
- **Nginx** with dynamic config reload via script
- **Caddy** — simple config with auto HTTPS

**Traefik Example Label on Container:**
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.frontend-abc123.rule=Host(`frontend-feature-login.preview.company.com`)"
  - "traefik.http.services.frontend-abc123.loadbalancer.server.port=3000"
```

---

## Database Schema

The GitHub App Server and Orchestrator share a database with the following tables:

### `projects`
| Column | Type | Description |
|---|---|---|
| id | UUID | Unique Project ID |
| name | string | Human-readable project name |
| created_at | timestamp | |

### `repo_project_mappings`
| Column | Type | Description |
|---|---|---|
| id | UUID | |
| project_id | UUID | Foreign key to projects |
| repo_full_name | string | e.g., `my-company/frontend` |
| github_installation_id | string | GitHub App installation ID |
| frontend_dockerfile_path | string | e.g., `./Dockerfile.frontend` |
| backend_dockerfile_path | string | e.g., `./Dockerfile.backend` |

### `deployments`
| Column | Type | Description |
|---|---|---|
| id | UUID | Unique Deployment ID |
| project_id | UUID | Foreign key to projects |
| repo_full_name | string | |
| branch | string | Branch name |
| commit_sha | string | Commit that triggered deployment |
| pr_number | integer | PR number (nullable) |
| status | enum | `pending`, `building`, `running`, `stopped`, `failed` |
| frontend_url | string | Preview URL for frontend |
| backend_url | string | Preview URL for backend |
| expires_at | timestamp | Auto-teardown time (nullable) |
| created_at | timestamp | |
| stopped_at | timestamp | |

### `deployment_configs` (stored in ENV Management Dashboard DB)
| Column | Type | Description |
|---|---|---|
| project_id | UUID | |
| deployment_lifetime | integer | Hours until auto-teardown (null = forever) |
| notify_branches | string | Branch pattern to notify (e.g., `*` or `feature/*`) |

---

## API Contracts

### GitHub App Server → Discord Bot
```
POST /notify-discord
{
  "project_id": "abc123",
  "repo": "my-company/frontend",
  "branch": "feature/login-page",
  "commit_sha": "a3f9c12",
  "commit_message": "Add login form",
  "author": "dev@company.com",
  "pr_number": 42
}
```

### Discord Bot → Deployment Orchestrator (on Yes)
```
POST /deploy
{
  "project_id": "abc123",
  "repo": "my-company/frontend",
  "branch": "feature/login-page",
  "commit_sha": "a3f9c12",
  "pr_number": 42,
  "approved_by": "discord-user-id"
}
```

### Deployment Orchestrator → ENV Server
```
GET /envs/abc123
Authorization: Bearer <API_KEY>
```

### Deployment Orchestrator → GitHub App Server (on completion)
```
POST /deployment-complete
{
  "deployment_id": "dep-xyz",
  "project_id": "abc123",
  "pr_number": 42,
  "commit_sha": "a3f9c12",
  "frontend_url": "https://frontend-feature-login.preview.company.com",
  "backend_url": "https://backend-feature-login.preview.company.com",
  "status": "running"
}
```

---

## Security Considerations

| Risk | Mitigation |
|---|---|
| Unauthorized webhook calls | Validate GitHub webhook signature on every request |
| ENV leakage | ENV Server only accessible on internal network, requires API key |
| Unauthorized deployments | Discord approval gate before any deployment |
| Container escape | Run containers with limited privileges, no `--privileged` flag |
| Preview URL abuse | Preview URLs only accessible within company network (VPN) or with basic auth |
| Secrets in Docker images | ENVs injected at runtime only, never baked into images |

---

## Open Questions for Team Discussion

1. **Docker Registry** — Should we push built images to a private Docker registry, or build on the deployment server directly?

2. **Branch Filtering** — Should all branches trigger a Discord notification, or only branches with open PRs? Or configurable per project?

3. **Multiple Repos per Project** — Can a single Project have both a frontend repo and a backend repo, or is each repo its own project?

4. **Deployment Teardown on Branch Delete** — Should the system automatically stop and remove a preview deployment when its branch is deleted on GitHub?

5. **Logs Access** — How should developers access build and runtime logs? From the dashboard only, or also posted to Discord?

6. **Hosting** — To be confirmed with senior: VPS specs, Docker setup, domain and wildcard SSL for `*.preview.company.com`

7. **Auth on Dashboard** — What auth method for the ENV Management Dashboard? Internal SSO, email/password, or GitHub OAuth?

---

*Document Version: 1.0*
*Status: Draft — for team review*
