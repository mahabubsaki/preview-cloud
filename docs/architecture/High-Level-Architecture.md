# High-Level Architecture

This system provides Vercel-style preview deployments for company repositories using self-hosted Docker infrastructure.

## System Diagram

```mermaid
graph TD
    Dev[Developer] -->|git push| GH[GitHub]
    GH -->|Webhook| GHS[GitHub App Server]
    GHS -->|Map Repo to Project| DB[(Database)]
    GHS -->|Approval Request| DBot[Discord Bot]
    DBot -->|✅ Yes| Orch[Deployment Orchestrator]
    DBot -->|❌ No| GHS
    
    Orch -->|Fetch Secrets| ES[ENV Server]
    Orch -->|Build/Run| DI[Docker Infrastructure]
    DI -->|Route URL| TR[Traefik Router]
    TR -->|Preview Link| GHS
    GHS -->|PR Comment| GH
```

## Core Design Goals
- Deployments triggered by GitHub events.
- Manual approval via Discord.
- Separate Docker containers per branch.
- Centralized ENV management.
- Automatic teardown on branch deletion.

---
[[Index|⬅️ Back to Index]]
