# Discord Bot

**Role:** The approval gateway.

## Interaction
1. Receives notification from [[GitHub App Server]].
2. Posts a message with buttons: `✅ Deploy` and `❌ Cancel`.
3. If clicked:
    - **Deploy**: Calls `POST /deploy` on [[Deployment Orchestrator]].
    - **Cancel**: Updates message and notifies [[GitHub App Server]] to stop.

## Tech Stack
- `discord.js`
- Discord Interaction Webhooks

---
[[Index|⬅️ Back to Index]]
