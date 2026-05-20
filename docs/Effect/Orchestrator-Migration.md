# Orchestrator → Effect Migration Guide

This guide outlines a phased plan to migrate the Deployment Orchestrator from imperative `try/catch` and `Promise`-based logic to a declarative **Effect**-based architecture.

## Why Migrate?

| Current Problem                        | Effect Solution                                      |
| -------------------------------------- | ---------------------------------------------------- |
| Manual `try/catch` everywhere          | Typed errors tracked at compile-time                 |
| Leaked resources on build failure      | `acquireRelease` guarantees cleanup                  |
| Sequential Docker builds               | `Effect.all` with `concurrency: "unbounded"`         |
| No retry logic for flaky ENV fetches   | `Effect.retry` with `Schedule.exponential`           |
| Unclear service dependencies           | `Layer`-based DI with compile-time tracking          |
| Hard to test without Docker daemon     | Mock `Layer` replaces real Docker service             |
| No structured cancellation             | Fiber interruption cascades to all children           |

## Phase 1: Define Services

Define clean service interfaces for each external dependency:

```ts
import { Context, Effect } from "effect";
import { Data } from "effect";

// Error types
class DockerBuildError extends Data.TaggedError("DockerBuildError")<{
  message: string;
  repository: string;
}> {}

class EnvFetchError extends Data.TaggedError("EnvFetchError")<{
  message: string;
  projectId: string;
}> {}

// Docker Service
class DockerService extends Context.Tag("DockerService")<
  DockerService,
  {
    readonly buildImage: (
      repo: string,
      branch: string,
      envs: Record<string, string>
    ) => Effect.Effect<string, DockerBuildError>;
    readonly runContainer: (
      imageId: string,
      labels: Record<string, string>
    ) => Effect.Effect<string>;
    readonly stopContainer: (containerId: string) => Effect.Effect<void>;
    readonly removeNetwork: (networkId: string) => Effect.Effect<void>;
  }
>() {}

// ENV Service
class EnvService extends Context.Tag("EnvService")<
  EnvService,
  {
    readonly getEnvs: (
      projectId: string
    ) => Effect.Effect<Record<string, string>, EnvFetchError>;
  }
>() {}

// GitHub Status Service
class GitHubStatusService extends Context.Tag("GitHubStatusService")<
  GitHubStatusService,
  {
    readonly updateStatus: (
      owner: string,
      repo: string,
      sha: string,
      state: "pending" | "success" | "failure" | "error",
      description: string
    ) => Effect.Effect<void>;
  }
>() {}
```

## Phase 2: Build the Deployment Pipeline

```ts
import { Effect, Schedule } from "effect";

const deployPreview = (params: {
  projectId: string;
  repo: string;
  branch: string;
  owner: string;
  sha: string;
}) =>
  Effect.gen(function* () {
    const docker = yield* DockerService;
    const envService = yield* EnvService;
    const github = yield* GitHubStatusService;

    // 1. Set GitHub status to pending
    yield* github.updateStatus(
      params.owner, params.repo, params.sha,
      "pending", "Building preview..."
    );

    // 2. Fetch ENVs with retry (exponential backoff, 3 attempts)
    const envs = yield* envService.getEnvs(params.projectId).pipe(
      Effect.retry({
        schedule: Schedule.exponential("1 second").pipe(
          Schedule.compose(Schedule.recurs(3))
        ),
        while: (err) => err._tag === "EnvFetchError"
      })
    );

    // 3. Build image with resource safety
    const containerId = yield* Effect.acquireUseRelease(
      // Acquire: build and run the container
      Effect.gen(function* () {
        const imageId = yield* docker.buildImage(
          params.repo, params.branch, envs
        );
        return yield* docker.runContainer(imageId, {
          "traefik.enable": "true",
          "traefik.http.routers.preview.rule":
            `Host(\`${params.branch}.preview.example.com\`)`,
        });
      }),

      // Use: report success
      (containerId) =>
        github.updateStatus(
          params.owner, params.repo, params.sha,
          "success", `Preview live at ${params.branch}.preview.example.com`
        ).pipe(Effect.as(containerId)),

      // Release: cleanup on any exit
      (containerId, exit) =>
        exit._tag === "Failure"
          ? docker.stopContainer(containerId).pipe(
              Effect.andThen(
                github.updateStatus(
                  params.owner, params.repo, params.sha,
                  "failure", "Build failed, resources cleaned up"
                )
              )
            )
          : Effect.void
    );

    return containerId;
  });
```

## Phase 3: Provide Layers

```ts
import { Layer } from "effect";

// Production layers
const DockerLive = Layer.succeed(DockerService, {
  buildImage: (repo, branch, envs) => /* ... real Nixpacks build ... */,
  runContainer: (imageId, labels) => /* ... real docker run ... */,
  stopContainer: (id) => /* ... real docker stop & rm ... */,
  removeNetwork: (id) => /* ... real docker network rm ... */,
});

const EnvServerLive = Layer.succeed(EnvService, {
  getEnvs: (projectId) => /* ... fetch from ENV server API ... */,
});

const GitHubLive = Layer.succeed(GitHubStatusService, {
  updateStatus: (owner, repo, sha, state, desc) =>
    /* ... Octokit createCommitStatus ... */,
});

// Compose all production layers
const AppLayer = Layer.mergeAll(DockerLive, EnvServerLive, GitHubLive);

// Run
const main = deployPreview({
  projectId: "proj-123",
  repo: "my-app",
  branch: "feature/login",
  owner: "user",
  sha: "abc123"
}).pipe(Effect.provide(AppLayer));

Effect.runPromise(main);
```

## Phase 4: Testing with Mock Layers

```ts
const DockerMock = Layer.succeed(DockerService, {
  buildImage: () => Effect.succeed("mock-image-id"),
  runContainer: () => Effect.succeed("mock-container-id"),
  stopContainer: () => Effect.void,
  removeNetwork: () => Effect.void,
});

const EnvMock = Layer.succeed(EnvService, {
  getEnvs: () => Effect.succeed({ NODE_ENV: "test", PORT: "3000" }),
});

const GitHubMock = Layer.succeed(GitHubStatusService, {
  updateStatus: () => Effect.void,
});

const TestLayer = Layer.mergeAll(DockerMock, EnvMock, GitHubMock);

// Test the full deployment pipeline without any real infrastructure
const testResult = await Effect.runPromise(
  deployPreview({
    projectId: "test-proj",
    repo: "test-repo",
    branch: "test-branch",
    owner: "test-owner",
    sha: "test-sha"
  }).pipe(Effect.provide(TestLayer))
);
```

## Phase 5: Parallel Builds

For projects with multiple services (frontend + backend):

```ts
const parallelBuild = Effect.gen(function* () {
  const docker = yield* DockerService;
  const envService = yield* EnvService;

  const envs = yield* envService.getEnvs("proj-123");

  // Build frontend and backend in parallel
  const [frontendImage, backendImage] = yield* Effect.all(
    [
      docker.buildImage("my-app/frontend", "main", envs),
      docker.buildImage("my-app/backend", "main", envs)
    ],
    { concurrency: "unbounded" }
  );

  // If either build fails, the other is automatically interrupted
  yield* Effect.log(`Built: ${frontendImage}, ${backendImage}`);
});
```

## Checklist

- [ ] **Phase 1**: Define `DockerService`, `EnvService`, `GitHubStatusService` interfaces
- [ ] **Phase 2**: Convert `deployPreview` to `Effect.gen` with `acquireUseRelease`
- [ ] **Phase 3**: Create `Layer` implementations for production
- [ ] **Phase 4**: Create mock layers and integration tests
- [ ] **Phase 5**: Enable parallel frontend/backend builds
- [ ] **Phase 6**: Add `Effect.retry` + `Schedule` for flaky operations
- [ ] **Phase 7**: Integrate structured logging with `Effect.log` and spans

---
See also: [[Services-and-Layers]], [[Resource-Management]], [[Error-Handling]], [[Concurrency]]

[[Index|⬅️ Back to Index]]
