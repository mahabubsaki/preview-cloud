# 🚀 Preview Platform Setup Guide

Follow these steps to get the Preview Platform running on a new machine.

## 📋 Prerequisites

Ensure you have the following installed:
1. **Bun**: [bun.sh](https://bun.sh/) (The primary runtime and package manager)
2. **Docker Desktop**: [docker.com](https://www.docker.com/) (Required for orchestrating preview containers)
3. **Git**: [git-scm.com](https://git-scm.com/)

---

## 🛠️ Installation Steps

### 1. Clone the Repository
```bash
git clone https://github.com/mahabubsaki/preview-cloud-ph
cd preview-cloud-ph
```

### 2. Install Dependencies
```bash
bun install
```

### 3. Environment Variables
Copy the example environment file and fill in your secrets (GitHub App credentials, etc.):
```bash
cp .env.example .env
```

### 4. Start Infrastructure (Redis & Postgres)
The project includes a `docker-compose.yml` for local development:
```bash
docker compose up -d
```

### 5. Initialize Database
Push the schema to your local Postgres instance:

- Run Generate
```bash
npx drizzle-kit generate
```

- Run Migration
```bash
npx drizzle-kit migrate
```

- Optional: Push directly
```bash
npx drizzle-kit push
```

### 6. Start Development Servers
Run the entire monorepo in development mode:
```bash
bun dev
```

### 7. Webhook Tunneling (GitHub Integration)
To receive webhooks from GitHub on your local machine, along with build and log endpoints, start the proxies:
```bash
bun proxies
```

---

## 🏗️ Architecture Overview

- **Dashboard**: Next.js app (Port 3000)
- **Backend API**: Elysia server (Port 3001)
- **Orchestrator**: Background worker for Docker deployments
- **Database**: Postgres (Drizzle ORM)
- **Queue**: Redis (BullMQ)

## 🐳 Docker Note
Make sure Docker Desktop is running and that you have a Docker network named `preview-net` if using production mode:
```bash
docker network create preview-net
```
