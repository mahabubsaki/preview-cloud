# Infrastructure

## Docker Hosting
- All preview deployments run as Docker containers on a centralized VPS.
- **Resource Management**: 5–10 concurrent deployments.

## Traefik Router
The router automatically detects containers via Docker labels.

### URL Pattern
`https://{project-id}-{branch-slug}.preview.company.com`

### Traefik Config Example
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.{id}.rule=Host(`{project}-{branch}.preview.company.com`)"
```

---
[[Index|⬅️ Back to Index]]
