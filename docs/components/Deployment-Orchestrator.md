# Deployment Orchestrator

**Role:** The engine that handles the heavy lifting of building and running containers.

## Key Decisions
- **No Registry**: Images are built directly on the host server to avoid network latency and registry management overhead.
- **Dynamic Networking**: Each deployment gets a unique Docker network namespace.

## Workflow
1. Receive `POST /deploy` from [[Discord Bot]].
2. Fetch ENVs from [[ENV Server]].
3. Run `docker build` for frontend/backend.
4. Run `docker run` with labels for [[Infrastructure|Traefik]].
5. Report status back to [[GitHub App Server]].

## Lifecycle
- **Status Tracking**: `PENDING` -> `BUILDING` -> `RUNNING` -> `STOPPED`.
- **Teardown**: Triggered by branch deletion or manual action from [[Management Dashboard]].

## Future Improvements with Effect
The Orchestrator's complex workflow can be significantly improved using [[Effect/Overview|Effect]]:

| Improvement                    | Effect Feature                                                    | Reference                                      |
| ------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------- |
| **Parallel Builds**            | `Effect.all` with `concurrency: "unbounded"`                      | [[Effect/Concurrency|Concurrency]]             |
| **Robust Retries**             | `Effect.retry` with `Schedule.exponential`                        | [[Effect/Error-Handling|Error Handling]]        |
| **Resource Safety**            | `Effect.acquireRelease` for Docker networks and containers        | [[Effect/Resource-Management|Resource Mgmt]]   |
| **Cancellation**               | Fiber interruption cascades to all concurrent builds              | [[Effect/Concurrency|Concurrency]]             |
| **Dependency Injection**       | `Layer`-based DI with `DockerService`, `EnvService`               | [[Effect/Services-and-Layers|Services & Layers]]|
| **Typed Errors**               | `DockerBuildError`, `EnvFetchError` tracked at compile-time       | [[Effect/Data-Types|Data Types]]               |
| **Testability**                | Mock layers replace real Docker daemon in tests                   | [[Effect/Services-and-Layers|Services & Layers]]|
| **Configuration**              | `Config.redacted` for API keys, `ConfigProvider` for environments | [[Effect/Configuration|Configuration]]         |

> 📋 See the full step-by-step plan: [[Effect/Orchestrator-Migration|Orchestrator → Effect Migration Guide]]

---
[[Index|⬅️ Back to Index]]
