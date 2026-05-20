# Database Schema

The system uses a shared database (PostgreSQL recommended) to track projects and deployments.

## Tables

### `projects`
| Column | Type | Description |
|---|---|---|
| id | UUID | Unique Project ID (used in URL) |
| name | string | Human-readable name |
| repo_url | string | Source GitHub repo |

### `deployments`
| Column | Type | Description |
|---|---|---|
| id | UUID | Unique Deployment ID |
| project_id | UUID | FK to [[projects]] |
| branch | string | Branch name |
| commit_sha | string | |
| status | enum | `pending`, `building`, `running`, `stopped` |
| preview_url | string | The final live URL |
| expires_at | timestamp | For auto-teardown |

---
[[Index|⬅️ Back to Index]]
