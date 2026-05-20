# GitHub App Server

**Role:** The entry point. Receives GitHub events and coordinates the rest of the system.

## Responsibilities
- Validate GitHub webhook signatures.
- Map `repo_full_name` to `project_id` via [[Database Schema]].
- Send approval requests to the [[Discord Bot]].
- Receive completion signals from the [[Deployment Orchestrator]].
- Post preview URLs to GitHub.

## Tech Stack
- **Node.js**
- `@octokit/app`
- `@octokit/webhooks`

## Webhook Events
- `push`
- `pull_request` (opened, synchronize, reopened)

---
[[Index|⬅️ Back to Index]]
