# Preview.Cloud — Engineering Evaluation Report

> **Methodology**: Google Software Engineering benchmark adapted for infrastructure platforms.
> **Codebase**: `preview-cloud-ph` monorepo — 3,722 lines of TypeScript across 3 apps + 1 shared package.
> **Date**: 2026-05-02 *(re-evaluation — updated from 2026-05-01)*

---

## Executive Summary

| Dimension | Previous | Current | Grade |
|---|---|---|---|
| 1. Architecture & Modularity | 3.5/5 | **4.0/5** | B+ |
| 2. Code Quality & Consistency | 3.0/5 | **3.5/5** | B |
| 3. Security | 2.0/5 | **2.5/5** | C |
| 4. Reliability & Fault Tolerance | 2.5/5 | **3.0/5** | B- |
| 5. Observability & Logging | 3.5/5 | **3.5/5** | B |
| 6. Testing | 0.5/5 | **0.5/5** | F |
| 7. Performance & Scalability | 2.5/5 | **2.5/5** | C |
| 8. DevOps & Deployment | 3.5/5 | **3.7/5** | B+ |
| 9. Error Handling | 3.0/5 | **3.5/5** | B |
| 10. Type Safety | 3.5/5 | **3.5/5** | B |
| 11. Documentation | 1.5/5 | **3.0/5** | B- |
| 12. Dependency Management | 3.0/5 | **3.0/5** | B- |
| **Overall** | **2.7/5** | **3.0/5** | **B-** |

> [!IMPORTANT]
> This revision reflects significant improvements across architecture, reliability, security, and documentation. Five previously-critical issues have been resolved. **Testing remains the single biggest risk** — zero tests exist across the entire codebase. The remaining critical issues (hardcoded credentials, build-arg secret exposure, notification worker connection leak) must be addressed before production.

---

## What Changed (Diff Summary)

| Area | Status | Detail |
|---|---|---|
| Service consolidation | ✅ Fixed | `DatabaseService`, `RedisService`, `QueueService`, `CryptoService` moved to `packages/core/services/` |
| Orphaned PubSub service | ✅ Fixed | `pubsub.ts` deleted, server `services/index.ts` re-exports from `@github-app/core` |
| Stale root `index.ts` | ✅ Fixed | File removed |
| 298-line god function | ✅ Fixed | Build pipeline split into `build-steps.ts` with 8 discrete exported functions |
| Webhook raw-body verification | ✅ Fixed | `rawBody = await request.text()` captured before parsing; passed directly to `webhooks.verify()` |
| Graceful shutdown | ✅ Fixed | Worker registers `SIGTERM`/`SIGINT` handlers; all workers use `Effect.addFinalizer` |
| Build/checkout timeout | ✅ Fixed | `checkoutRepository` wrapped with `Effect.timeout("5 minutes")`; `ShellService.run` also has 5-minute timeout |
| `.dockerignore` | ✅ Added | Covers `temp/`, env files, `.turbo/`, per-app `node_modules` |
| Custom error types | ✅ Added | `WebhookError`, `QueueError`, `RedisError` defined as `Data.TaggedError`; `BuildError` phases used consistently in `build-steps.ts` |
| README | ✅ Rewritten | Full architecture overview, quick-start guide, config reference, API table, queue diagram |
| Hardcoded DB credentials | ❌ Remains | `docker-compose.yml` still hardcodes `preview_pass_99` in 4 places |
| Build-arg secret exposure | ❌ Remains | `--build-arg` still used for env vars in `buildDockerImage` |
| Notify worker Redis leak | ❌ Remains | `notify.ts` creates a new `IORedis` connection per notification and disconnects after |
| `readdirSync` in framework | ❌ Partial | Main detection path is async; fallback directory scan still uses `readdirSync` |
| SSE polling loop | ❌ Remains | 100ms `setTimeout` loop still present in `main.ts` |
| Tests | ❌ Remains | Zero tests, no test runner, no CI |

---

## 1. Architecture & Modularity — 4.0/5 *(was 3.5)*

### Strengths
- **Clean monorepo structure**: `apps/server`, `apps/worker`, `apps/dashboard`, `packages/core` — proper separation of concerns
- **Shared service layer**: `DatabaseService`, `RedisService`, `QueueService`, `CryptoService` all live in `packages/core/services/`. Apps re-export from core — no more duplication ✅
- **Modular build pipeline**: [build-steps.ts](apps/worker/src/workers/build-steps.ts) exports 8 discrete, testable steps (`updateDeploymentStatus`, `fetchEnvironmentVariables`, `checkoutRepository`, `detectProjectMetadata`, `buildDockerImage`, `cleanupPreviousDeployments`, `launchContainer`, `notifyCompletion`) ✅
- **Event-driven architecture**: BullMQ queues (`DEPLOYMENT → BUILD → NOTIFY`) with clear job boundaries
- **Eden Treaty**: Type-safe API client between dashboard and server

### Remaining Issues

#### 🟡 Medium: Mixed Paradigms in Delete Worker
[delete.ts](apps/worker/src/workers/delete.ts) still uses Bun's `$` template literal shell commands alongside Effect-TS, while the build worker has been fully migrated to the `ShellService` abstraction.

**Fix**: Migrate `delete.ts` to use `ShellService.run(["docker", ...])` for consistency.

#### 🟡 Medium: `try/catch` Inside `Effect.gen`
[build.ts:66-122](apps/worker/src/workers/build.ts#L66-L122) uses a `try/catch/finally` block inside `Effect.gen`, bypassing Effect's structured error handling and finalizer system.

**Fix**: Replace `try/catch` with `Effect.catchAll` and `finally` with `Effect.ensuring` or `Effect.addFinalizer`.

---

## 2. Code Quality & Consistency — 3.5/5 *(was 3.0)*

### Strengths
- Consistent use of `Effect.gen` generators across services
- `satisfies` keyword used in job payloads for compile-time safety
- Clean kebab-case naming for container/hostname generation
- Build pipeline extracted into single-responsibility functions ✅

### Remaining Issues

#### 🟡 Medium: Inline Styles Everywhere
All React components use inline `style={{}}` objects. [DeploymentItem.tsx](apps/dashboard/src/components/DeploymentItem.tsx) has 50+ inline style declarations. This defeats CSS caching and makes theming impossible.

**Fix**: Use CSS modules, or at minimum extract style constants.

#### 🟡 Medium: Hardcoded Container Label Schema
Labels like `"projectId=${safeProjectId}"` and `"branch=${safeBranch}"` are string-concatenated in both [build-steps.ts](apps/worker/src/workers/build-steps.ts) and [delete.ts](apps/worker/src/workers/delete.ts). No shared label schema exists.

**Fix**: Create `packages/core/labels.ts` with `makeLabels(projectId, branch)` and `parseLabels(container)`.

#### 🟡 Medium: `as any` Casts
- [build-steps.ts:51](apps/worker/src/workers/build-steps.ts#L51): `phase: "status_update" as any` — `"status_update"` is not a valid `BuildError` phase
- [notify.ts:33](apps/server/src/workers/notify.ts#L33): `status: dbStatus as any`
- [EnvEditor.tsx:36](apps/dashboard/src/components/EnvEditor.tsx#L36): `(newEnvs[index] as any)[field] = val`

**Fix**: Extend the `BuildError` phase union to include `"status_update"`; define a proper DB status type.

#### 🟢 Minor: Inconsistent Indentation in `delete.ts`
[delete.ts:43-58](apps/worker/src/workers/delete.ts#L43-L58) has misaligned indentation compared to the rest of the file.

---

## 3. Security — 2.5/5 *(was 2.0)*

> [!CAUTION]
> Critical security issues remain. Do not deploy to production without resolving hardcoded credentials and build-arg secret exposure.

#### ✅ Resolved: Webhook Signature Verification
`rawBody` is now captured via `await request.text()` before parsing and passed directly to `webhooks.verify()`. The `JSON.stringify` bug is fixed.

#### ✅ Partial: GitHub Token in Logs
`ShellService` sanitizes `GITHUB_TOKEN` in error messages and command strings. Token no longer leaks into logs.

#### 🔴 Critical: Hardcoded Database Credentials
[docker-compose.yml:29](docker-compose.yml#L29):
```yaml
POSTGRES_PASSWORD: preview_pass_99
```
The password is hardcoded in 4 places across the compose file and committed to version control.

**Fix**: Replace all occurrences with `${POSTGRES_PASSWORD}` and document it in `.env.example`.

#### 🔴 Critical: GitHub Token in Build Args
[build-steps.ts:188](apps/worker/src/workers/build-steps.ts#L188):
```typescript
const buildArgs = Object.entries(envs).flatMap(([k, v]) => ["--build-arg", `${k}=${v}`]);
```
`--build-arg` values are visible in `docker history`. If any env variable contains secrets (DB passwords, API keys), they're permanently baked into the image layer.

**Fix**: Use Docker BuildKit `--secret` mount or a multi-stage build pattern that does not persist build-time args.

#### 🔴 Critical: Traefik Dashboard Exposed with Hardcoded Auth
[docker-compose.yml:73](docker-compose.yml#L73):
```yaml
traefik.http.middlewares.auth.basicauth.users=admin:$$apr1$$S.896.T.$$vGZ2R0lBTozM4k.FhX2A/0
```
Hardcoded basic auth credentials for the Traefik dashboard are committed to version control.

**Fix**: Move to `${TRAEFIK_BASIC_AUTH}` environment variable or disable the dashboard in production.

#### 🟡 Medium: No Rate Limiting on Webhook Endpoint
Any caller can spam `POST /webhooks` with no rate limiting.

#### 🟡 Medium: Env Values Visible in Build Logs
The `.env` file is written to disk inside `repoDir` as part of the build. Build args and env file path are logged.

#### 🟡 Medium: Redis Without Authentication
[docker-compose.yml:43-54](docker-compose.yml#L43-L54) — Redis runs with no password.

---

## 4. Reliability & Fault Tolerance — 3.0/5 *(was 2.5)*

### Strengths
- BullMQ provides automatic retry (`attempts: 3` on cleanup jobs)
- Health checks on Postgres and Redis in docker-compose
- Discord worker failures are caught and logged without crashing the process
- **Graceful shutdown added** ✅ — `apps/worker/src/main.ts` registers `SIGTERM`/`SIGINT` handlers; all four workers use `Effect.addFinalizer` to close connections cleanly
- **Build timeout added** ✅ — `checkoutRepository` has `Effect.timeout("5 minutes")`; `ShellService.run` enforces a 5-minute timeout per command

### Remaining Issues

#### 🔴 Critical: Notification Worker Creates New Redis Connection Per Message
[notify.ts:41-61](apps/server/src/workers/notify.ts#L41-L61): A new `IORedis` connection is created for every notification and disconnected after publishing. Under load (many deployments), this risks exhausting the Redis connection limit.

**Fix**: Inject `RedisService` via Effect, reuse `redis.connection` for publishing, or use the `publish` method already provided by the service.

#### 🟡 Medium: No Dead Letter Queue
Failed build and delete jobs have no DLQ configuration. After max retries, jobs are silently discarded.

**Fix**: Configure `deadLetterQueue` in BullMQ worker options.

#### 🟡 Medium: No Health Endpoint
The server has `GET /` but no proper `/health` endpoint that checks DB and Redis connectivity. Kubernetes and Traefik health probes have nothing to check.

#### 🟡 Medium: Unbounded Docker Build Cache
There is no disk space check before cloning or building, and no `--no-cache` or periodic cache prune. A long-running worker will eventually exhaust disk.

---

## 5. Observability & Logging — 3.5/5 *(unchanged)*

### Strengths
- Structured Effect-TS logging with timestamps and fiber IDs
- Real-time log streaming via Redis pub/sub + SSE
- Build logs persisted to database
- Emoji-prefixed console logs for quick visual scanning

### Issues

#### 🟡 Medium: No Structured Log Format
Logs mix `console.log` with `Effect.log`. There's no consistent JSON logging for machine parsing.

**Fix**: Use a structured logger (e.g., `pino`) and pipe Effect logs through it.

#### 🟡 Medium: No Metrics
No Prometheus/StatsD metrics for:
- Build duration histograms
- Queue depth
- Active container count
- Error rates

#### 🟡 Medium: No Request Tracing
No correlation ID through webhook → deployment → build → notify pipeline. Makes debugging multi-step failures hard.

**Fix**: Generate a `traceId` at webhook ingestion and pass through all jobs.

---

## 6. Testing — 0.5/5 *(unchanged)*

> [!CAUTION]
> **Zero tests exist in the entire codebase.** No unit tests, no integration tests, no e2e tests. This is the single biggest risk factor.

#### 🔴 Critical: No Test Infrastructure
- No test runner configured (`vitest`, `jest`, or `bun test`)
- No test scripts in any `package.json`
- No `__tests__` or `*.test.ts` files
- No CI pipeline (no GitHub Actions)

**Fix (Priority Order)**:
1. Add `vitest` and write unit tests for `packages/core` (crypto, schema validation)
2. Integration tests for webhook handler (mock DB/Redis)
3. E2e tests for the build pipeline using Docker-in-Docker
4. GitHub Actions CI workflow

---

## 7. Performance & Scalability — 2.5/5 *(unchanged)*

### Strengths
- BullMQ concurrency controls (`BUILD_CONCURRENCY=2`, `DELETE_CONCURRENCY=5`)
- Resource limits on preview containers (`--memory=256m`, `--cpus=0.5`)
- Bounded SSE message buffer (256 entries)

### Issues

#### 🟡 Medium: `readdirSync` in Framework Detection Fallback
[framework.ts:62-67](apps/worker/src/orchestrator/framework.ts#L62-L67): The main detection path is async, but the directory-scan fallback still uses `readdirSync`, which blocks the event loop.

**Fix**: Replace with `fs.promises.readdir` wrapped in `Effect.tryPromise`.

#### 🟡 Medium: SSE 100ms Polling Loop
[main.ts:138](apps/server/src/main.ts#L138) polls every 100ms even when idle. With 50 connected tabs, that's 500 wake-ups/second.

**Fix**: Replace the polling loop with `EventEmitter`-driven `await` using a `once(emitter, 'message')` pattern.

#### 🟡 Medium: Full Repository Clone Every Build
`git clone --depth 1` is used, but the repo is cloned to disk, built, then deleted. With concurrent builds, disk I/O becomes a bottleneck.

**Fix**: Use Docker BuildKit with `--mount=type=cache` for node_modules. Consider a persistent build cache.

#### 🟡 Medium: N+1 Queries in Env-Triggered Redeploy
[actions.ts:91-125](apps/dashboard/src/app/actions.ts#L91-L125): For each affected deployment, the code runs a separate `db.select().from(projectRepositories)` query.

**Fix**: Batch fetch all repos in a single query using `inArray`.

---

## 8. DevOps & Deployment — 3.7/5 *(was 3.5)*

### Strengths
- Multi-stage Docker builds for dashboard
- Docker socket proxy for security (`tecnativa/docker-socket-proxy`)
- Traefik for production reverse proxy with automatic routing
- Configurable env vars for ports, memory, CPU limits
- Development/production mode toggle
- **`.dockerignore` added** ✅ — covers `temp/`, env files, `.turbo/`, per-app `node_modules`

### Remaining Issues

#### 🟡 Medium: Dashboard Dockerfile Copies Entire Workspace
[Dashboard Dockerfile:10](apps/dashboard/Dockerfile#L10): `COPY apps ./apps` — copies all apps (server, worker) into the dashboard build. The build context transfer is unnecessarily large.

**Fix**: `COPY apps/dashboard ./apps/dashboard` only.

#### 🟡 Medium: `.dockerignore` Missing Root `node_modules` and `.git`
The current `.dockerignore` covers `apps/*/node_modules` and `packages/*/node_modules` but not the root-level `node_modules` or `.git` directory.

**Fix**: Add `node_modules`, `.git`, and `*.log` to `.dockerignore`.

#### 🟡 Medium: No CI/CD Pipeline
No GitHub Actions, no automated testing, no automated deployment.

#### 🟢 Minor: `RUN bun install` Without Lockfile Pinning
Dockerfiles use `RUN bun install` instead of `bun install --frozen-lockfile`, which can result in non-deterministic builds.

---

## 9. Error Handling — 3.5/5 *(was 3.0)*

### Strengths
- Domain-specific TaggedErrors: `BuildError`, `DockerError`, `DiscordError`, `PortAllocationError`, `ShellError` ✅
- **New service-level errors**: `WebhookError`, `QueueError`, `RedisError` all now defined as `Data.TaggedError` ✅
- `BuildError` phases are now used consistently throughout `build-steps.ts` ✅
- `Effect.tryPromise` with explicit `catch` handlers
- Zod validation at queue boundaries

### Remaining Issues

#### 🟡 Medium: `"status_update"` Not a Valid `BuildError` Phase
[build-steps.ts:51](apps/worker/src/workers/build-steps.ts#L51): `phase: "status_update" as any` — this phase is not part of the `BuildError` union, requiring an `as any` cast.

**Fix**: Add `"status_update"` to the `BuildError` phase union in `apps/worker/src/errors.ts`.

#### 🟡 Medium: `status: dbStatus as any` in Notify Worker
[notify.ts:33](apps/server/src/workers/notify.ts#L33): The status is cast with `as any` instead of using a proper type guard.

**Fix**: Define a `DeploymentStatus` type in `packages/core` and use it in both the schema and the update query.

#### 🟡 Medium: Silent Fallback in Crypto
[crypto.ts:17](packages/core/crypto.ts#L17): `if (!encryptedText.includes(":")) return encryptedText;` — If decryption receives unencrypted data, it silently returns it. This hides data corruption.

**Fix**: Log a warning when encountering non-encrypted data.

---

## 10. Type Safety — 3.5/5 *(unchanged)*

### Strengths
- Strict TypeScript config: `strict: true`, `noUncheckedIndexedAccess`, `noImplicitOverride`
- Zod schemas for all queue payloads with `z.infer` types
- Effect Tags with explicit service interfaces
- Eden Treaty for end-to-end type safety between dashboard and server

### Issues

#### 🟡 Medium: `noUnusedLocals` and `noUnusedParameters` Disabled
[tsconfig.json:25-26](tsconfig.json#L25-L26) — This allows dead code to accumulate.

#### 🟡 Medium: Missing Return Type Annotations
Most functions rely on type inference. Adding explicit return types to public APIs would catch regressions.

#### 🟢 Minor: `any` in Effect.Effect Generic
`Effect.Effect<A, E, any>` is used in `runEffect` and `runAction` — the `any` for the context parameter loses type safety for required services.

---

## 11. Documentation — 3.0/5 *(was 1.5)*

### Strengths *(all new)*
- **Architecture overview** with ASCII diagram and data-flow explanation ✅
- **Quick-start guide**: prerequisites, clone, env setup, Docker network, DB migration, local dev ✅
- **Configuration reference**: full table of all env vars with required/optional status ✅
- **API endpoint table** with method, path, and description ✅
- **Queue architecture diagram** showing the full pipeline ✅
- **Tech stack table** and supported frameworks matrix ✅

### Remaining Issues

#### 🟡 Medium: No Code Comments on Complex Logic
Framework detection, Dockerfile generation, and port allocation have no doc comments explaining the algorithms.

#### 🟡 Medium: No ADRs
No Architecture Decision Records for choices like Effect-TS, BullMQ, Traefik, or the SSE approach.

#### 🟢 Minor: `packages/core` Not Reflected in Project Structure Diagram
README's project structure section mentions `crypto.ts` and `types/` but does not show the new `services/` directory.

---

## 12. Dependency Management — 3.0/5 *(unchanged)*

### Strengths
- Workspace protocol (`workspace:*`) for internal packages
- Turbo for build orchestration with dependency graph

### Issues

#### 🟡 Medium: Root Dependencies Leak
[package.json](package.json) has `effect`, `drizzle-orm`, and `pg` as root dependencies. These should only be in the packages that use them.

#### 🟡 Medium: Version Ranges Too Wide
- `"@types/bun": "latest"` — pins to whatever is current at install time
- `"turbo": "latest"` — same issue
- `"effect": "*"` in server's package.json

**Fix**: Pin to exact versions or `~` ranges.

#### 🟢 Minor: `@effect/experimental` in Root
Listed as a devDependency but not imported anywhere.

---

## Priority Improvement Roadmap

### Phase 1 — Critical (Week 1)
| # | Item | Files | Impact |
|---|---|---|---|
| 1 | Add basic test suite | New: `packages/core/__tests__/` | Prevents regressions |
| 2 | Remove hardcoded DB credentials | `docker-compose.yml` | Security |
| 3 | Fix Docker build-arg secret exposure | `apps/worker/src/workers/build-steps.ts` | Security |
| 4 | Fix notification worker Redis leak | `apps/server/src/workers/notify.ts` | Reliability |
| 5 | Move Traefik auth to env variable | `docker-compose.yml` | Security |

### Phase 2 — High (Week 2-3)
| # | Item | Files | Impact |
|---|---|---|---|
| 6 | Add `/health` endpoint | `apps/server/src/main.ts` | Operations |
| 7 | Add CI pipeline (GitHub Actions) | New: `.github/workflows/ci.yml` | Quality |
| 8 | Migrate `delete.ts` to `ShellService` | `apps/worker/src/workers/delete.ts` | Consistency |
| 9 | Replace `try/catch` with Effect finalizers in `build.ts` | `apps/worker/src/workers/build.ts` | Correctness |
| 10 | Add Redis authentication | `docker-compose.yml` | Security |

### Phase 3 — Medium (Month 2)
| # | Item | Files | Impact |
|---|---|---|---|
| 11 | Add structured JSON logging | All apps | Observability |
| 12 | Add request tracing/correlation IDs | Queue schemas, handlers | Debugging |
| 13 | Add dead letter queues | Worker configs | Reliability |
| 14 | Replace inline styles with CSS modules | Dashboard components | Maintainability |
| 15 | Pin all dependency versions | `package.json` files | Reproducibility |

### Phase 4 — Polish (Month 3)
| # | Item | Files | Impact |
|---|---|---|---|
| 16 | Add Prometheus metrics | New: metrics service | Observability |
| 17 | E2e test suite | New: `e2e/` | Quality |
| 18 | ADR documentation | New: `docs/adr/` | Knowledge |
| 19 | Replace SSE polling with event-driven | `apps/server/src/main.ts` | Performance |
| 20 | Async `readdirSync` in framework detection | `apps/worker/src/orchestrator/framework.ts` | Performance |
