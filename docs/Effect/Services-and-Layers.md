# Effect Services & Layers

Services and Layers are Effect's **dependency injection** system. They let you define what your program needs (interfaces) and provide implementations later — enabling easy testing, swapping, and composition.

## Core Concepts

```
┌─────────────┐
│   Service    │  ← Interface (what you need)
├─────────────┤
│   Context    │  ← A container holding service implementations
├─────────────┤
│    Layer     │  ← A recipe for building services
└─────────────┘
```

## Defining a Service

Use `Context.GenericTag` to define a service interface:

```ts
import { Context, Effect } from "effect";

// Define the service interface
class DockerService extends Context.Tag("DockerService")<
  DockerService,
  {
    readonly buildImage: (repo: string, branch: string) => Effect.Effect<string>;
    readonly runContainer: (imageId: string) => Effect.Effect<string>;
    readonly stopContainer: (containerId: string) => Effect.Effect<void>;
  }
>() {}
```

## Using a Service

Access the service inside an `Effect.gen`:

```ts
const deployPreview = Effect.gen(function* () {
  const docker = yield* DockerService;
  const imageId = yield* docker.buildImage("my-repo", "feature/login");
  const containerId = yield* docker.runContainer(imageId);
  yield* Effect.log(`Container started: ${containerId}`);
  return containerId;
});
// Type: Effect<string, never, DockerService>
//                                  ↑ tracked requirement
```

## Providing a Service Implementation

### Direct (for simple cases)

```ts
const program = deployPreview.pipe(
  Effect.provideService(DockerService, {
    buildImage: (repo, branch) => Effect.succeed(`img-${branch}`),
    runContainer: (id) => Effect.succeed(`container-${id}`),
    stopContainer: (_) => Effect.void
  })
);
```

### Using `Layer` (recommended for production)

A `Layer` is a recipe that describes **how** to build a service. Layers can have their own dependencies, and Effect resolves them automatically.

```ts
import { Layer } from "effect";

// A layer that provides DockerService
const DockerLive = Layer.succeed(DockerService, {
  buildImage: (repo, branch) => Effect.succeed(`img-${branch}`),
  runContainer: (id) => Effect.succeed(`container-${id}`),
  stopContainer: (_) => Effect.void
});

// Provide the layer to your program
const runnable = Effect.provide(deployPreview, DockerLive);
```

### Layers with Dependencies

Layers can depend on other services:

```ts
const OrchestratorLive = Layer.effect(
  OrchestratorService,
  Effect.gen(function* () {
    const docker = yield* DockerService;
    const envServer = yield* EnvService;
    return {
      deploy: (projectId, branch) => Effect.gen(function* () {
        const envs = yield* envServer.getEnvs(projectId);
        const imageId = yield* docker.buildImage(projectId, branch);
        return yield* docker.runContainer(imageId);
      })
    };
  })
);
```

### Composing Layers

```ts
// Merge independent layers
const InfraLayer = Layer.merge(DockerLive, EnvServerLive);

// Compose dependent layers
const AppLayer = Layer.provide(OrchestratorLive, InfraLayer);

// Use it
const program = deployPreview.pipe(Effect.provide(AppLayer));
```

## `Effect.Service` (Simplified Syntax)

For simpler services, use the class-based shorthand:

```ts
class NotificationService extends Effect.Service<NotificationService>()(
  "NotificationService",
  {
    effect: Effect.gen(function* () {
      return {
        notify: (msg: string) => Effect.log(`📢 ${msg}`)
      };
    })
  }
) {}

// Usage
const program = Effect.gen(function* () {
  const notifier = yield* NotificationService;
  yield* notifier.notify("Deployment complete!");
});

// Provide via the auto-generated Default layer
Effect.provide(program, NotificationService.Default);
```

## `ManagedRuntime`

For integrations with frameworks (Express, Next.js, etc.) where you don't control the main entry point:

```ts
import { ManagedRuntime } from "effect";

const runtime = ManagedRuntime.make(AppLayer);

// Use in an Express handler
app.post("/deploy", async (req, res) => {
  const result = await runtime.runPromise(deployPreview);
  res.json({ containerId: result });
});

// Clean up on shutdown
process.on("SIGTERM", () => runtime.dispose());
```

## Testing with Mock Layers

```ts
const DockerMock = Layer.succeed(DockerService, {
  buildImage: () => Effect.succeed("mock-image-id"),
  runContainer: () => Effect.succeed("mock-container-id"),
  stopContainer: () => Effect.void
});

// Use mock layer in tests
const testProgram = Effect.provide(deployPreview, DockerMock);
```

> [!TIP]
> This is one of Effect's biggest advantages for our project: you can test the [[Deployment-Orchestrator]] without needing a real Docker daemon.

---
See also: [[Overview]], [[Configuration]], [[Resource-Management]]

[[Index|⬅️ Back to Index]]
