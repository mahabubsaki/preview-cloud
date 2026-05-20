# ENV Server

**Role:** Secure, centralized store for project environment variables.

## Security
- Internal network access only.
- API Key authentication required for the [[Deployment Orchestrator]].
- Encrypted storage for sensitive secrets.

## API
- `GET /envs/:project_id` — Returns key-value pairs for the build/runtime.

---
[[Index|⬅️ Back to Index]]
