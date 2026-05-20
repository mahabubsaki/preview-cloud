# Effect Resource Management

Effect provides built-in support for **safe resource acquisition and release**, ensuring that resources like Docker containers, database connections, file handles, and network sockets are always properly cleaned up — even when errors or interruptions occur.

## `acquireUseRelease`

The simplest resource management pattern. Acquire a resource, use it, then release it — guaranteed:

```ts
import { Effect } from "effect";

const withContainer = Effect.acquireUseRelease(
  // Acquire: start the container
  Effect.tryPromise(() => docker.createContainer({ Image: "my-app" })),

  // Use: interact with the container
  (container) => Effect.gen(function* () {
    yield* Effect.log(`Container ${container.id} is running`);
    // ... do work ...
    return container.id;
  }),

  // Release: always stop the container (even on error/interruption)
  (container) => Effect.promise(() => container.stop())
);
```

> [!IMPORTANT]
> The **release** function is guaranteed to run, regardless of whether the use phase succeeds, fails, or is interrupted. This is critical for preventing resource leaks in our deployment system.

## `acquireRelease` (with Scope)

For more composable resource management, use `acquireRelease` with a `Scope`:

```ts
import { Effect } from "effect";

// Define a managed resource
const managedContainer = Effect.acquireRelease(
  // Acquire
  Effect.tryPromise(() => docker.createContainer({ Image: "my-app" })),
  // Release (runs when scope closes)
  (container) => Effect.promise(() => container.stop())
);

// Use it within a scope
const program = Effect.scoped(
  Effect.gen(function* () {
    const container = yield* managedContainer;
    yield* Effect.log(`Using container: ${container.id}`);
    // Container is automatically stopped when this scope exits
  })
);
```

### Composing Multiple Resources

```ts
const program = Effect.scoped(
  Effect.gen(function* () {
    const network = yield* managedNetwork;
    const frontend = yield* managedFrontendContainer;
    const backend = yield* managedBackendContainer;

    yield* Effect.log("All resources acquired");
    // ... do work ...

    // All resources released in reverse order when scope exits
  })
);
```

## Finalizers

Add cleanup logic that runs when the enclosing scope closes:

```ts
const program = Effect.scoped(
  Effect.gen(function* () {
    yield* Effect.addFinalizer((exit) =>
      Effect.gen(function* () {
        if (exit._tag === "Success") {
          yield* Effect.log("Completed successfully");
        } else {
          yield* Effect.log("Failed or interrupted, cleaning up...");
        }
      })
    );

    // ... main logic ...
  })
);
```

## Caching

### `Effect.cached` — Lazy compute-once

```ts
const expensiveConfig = yield* Effect.cached(
  Effect.tryPromise(() => fetch("/api/config").then(r => r.json()))
);

// First call computes, subsequent calls return cached value
const config1 = yield* expensiveConfig; // fetches
const config2 = yield* expensiveConfig; // cached
```

### `Effect.cachedWithTTL` — Cache with expiration

```ts
const cachedEnvs = yield* Effect.cachedWithTTL(
  fetchProjectEnvs(projectId),
  "5 minutes"
);
```

### `Cache` module — Full-featured cache

```ts
import { Cache, Duration } from "effect";

const cache = yield* Cache.make({
  capacity: 100,
  timeToLive: Duration.minutes(5),
  lookup: (key: string) => fetchFromDatabase(key)
});

const value = yield* cache.get("project-abc");
// Concurrent lookups for the same key only compute once
```

## Real-World Pattern: Preview Deployment

Here's how resource management maps to our deployment system:

```ts
const deployPreview = (projectId: string, branch: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      // 1. Create Docker network (auto-cleaned)
      const network = yield* Effect.acquireRelease(
        createNetwork(`preview-${projectId}`),
        (net) => removeNetwork(net.id)
      );

      // 2. Build and run containers (auto-cleaned)
      const container = yield* Effect.acquireRelease(
        buildAndRunContainer(projectId, branch, network),
        (c) => stopAndRemoveContainer(c.id)
      );

      // 3. Register Traefik route (auto-cleaned)
      yield* Effect.acquireRelease(
        registerRoute(container, branch),
        (route) => unregisterRoute(route)
      );

      // 4. Wait for deployment lifetime or cancellation
      yield* Effect.sleep("24 hours");

      // All resources automatically cleaned up when scope exits
    })
  );
```

> [!TIP]
> This pattern guarantees that if a build fails midway, all already-acquired resources (networks, containers, routes) are properly cleaned up.

---
See also: [[Overview]], [[Concurrency]], [[Services-and-Layers]]

[[Index|⬅️ Back to Index]]
