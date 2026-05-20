# Deployment Flow

The end-to-end lifecycle of a preview deployment.

### 1. Trigger
Developer pushes code or opens a PR. GitHub sends a webhook to the [[GitHub App Server]].

### 2. Approval
The [[Discord Bot]] posts an interactive message. A team member must click **✅ Yes** to proceed.

### 3. Build & Deploy
The [[Deployment Orchestrator]]:
1. Fetches environment variables from the [[ENV Server]].
2. Clones the specific branch.
3. **Builds images directly on the server** (to optimize for speed/simplicity).
4. Launches containers in an isolated Docker network.

### 4. Routing
The [[Infrastructure|Traefik Router]] detects the new containers and maps them to:
`https://{project-id}-{branch-slug}.preview.company.com`

### 5. Feedback
The [[GitHub App Server]] posts the live URL back to the GitHub PR as a comment and status check.

### 6. Cleanup
When the branch is deleted on GitHub, the system triggers an automatic teardown.

---
[[Index|⬅️ Back to Index]]
