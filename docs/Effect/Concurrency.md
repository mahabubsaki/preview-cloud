# Effect Concurrency

Effect provides **structured concurrency** via lightweight fibers. All concurrent operations are automatically supervised, and child fibers are interrupted when parents complete.

## Fibers

A **Fiber** is a lightweight virtual thread managed by the Effect runtime. Every running effect executes on a fiber.

### Forking a Fiber

```ts
import { Effect, Fiber } from "effect";

const program = Effect.gen(function* () {
  // Fork a background task
  const fiber = yield* Effect.fork(
    Effect.gen(function* () {
      yield* Effect.sleep("5 seconds");
      yield* Effect.log("Background task done");
      return 42;
    })
  );

  yield* Effect.log("Main continues immediately");

  // Join to wait for the result
  const result = yield* Fiber.join(fiber);
  // result = 42
});
```

## Running Tasks in Parallel

### `Effect.all` with concurrency options

```ts
const buildFrontend = Effect.log("Building frontend...");
const buildBackend = Effect.log("Building backend...");
const runMigrations = Effect.log("Running migrations...");

// Run all in parallel
const buildAll = Effect.all(
  [buildFrontend, buildBackend, runMigrations],
  { concurrency: "unbounded" }
);
```

### Concurrency Options

| Option                      | Behavior                                        |
| --------------------------- | ----------------------------------------------- |
| `concurrency: 1` (default)  | Sequential execution                            |
| `concurrency: 2`            | Up to 2 concurrent fibers                       |
| `concurrency: "unbounded"`  | No limit                                        |
| `concurrency: "inherit"`    | Inherits from surrounding `Effect.withConcurrency` |

> [!TIP]
> Use `concurrency: 2` for rate-limited APIs or when you want to control resource usage.

### Structured Concurrency

When running effects concurrently with `Effect.all`, if one fails:
- All other concurrent fibers are **automatically interrupted**
- You don't need to manage cleanup manually

```ts
// If task2 fails, task1 and task3 are interrupted automatically
const program = Effect.all([task1, task2, task3], {
  concurrency: "unbounded"
});
```

## Racing Effects

### `Effect.race` — First success wins

```ts
const fast = Effect.delay(Effect.succeed("Fast"), "1 second");
const slow = Effect.delay(Effect.succeed("Slow"), "5 seconds");

const winner = Effect.race(fast, slow); // "Fast", slow is interrupted
```

### `Effect.raceAll` — Race multiple effects

```ts
const winner = Effect.raceAll([task1, task2, task3]);
// First to succeed wins, others are interrupted
```

### `Effect.raceFirst` — First to complete (success OR failure)

```ts
const first = Effect.raceFirst(task1, task2);
// Whichever finishes first, regardless of success/failure
```

## Interruption

Effects can be interrupted. When a fiber is interrupted, its finalizers still run.

```ts
const cancellable = Effect.gen(function* () {
  yield* Effect.addFinalizer(() =>
    Effect.log("Cleaning up resources...")
  );
  yield* Effect.sleep("1 hour"); // Will be interrupted
});

const program = Effect.gen(function* () {
  const fiber = yield* Effect.fork(cancellable);
  yield* Effect.sleep("5 seconds");
  yield* Fiber.interrupt(fiber); // Triggers finalizer
});
```

### `onInterrupt` handler

```ts
const task = Effect.log("Working...").pipe(
  Effect.onInterrupt(() => Effect.log("Task was interrupted!"))
);
```

### Cascading Interruption

When concurrent effects are interrupted, all siblings are also interrupted:

```ts
// If #2 is interrupted, #1 and #3 are too
const program = Effect.forEach(
  [task1, task2, task3],
  (task) => task,
  { concurrency: "unbounded" }
);
```

## `Promise.all` vs `Effect.all` Equivalents

| Promise API            | Effect Equivalent                                       |
| ---------------------- | ------------------------------------------------------- |
| `Promise.all`          | `Effect.all([...], { concurrency: "unbounded" })`       |
| `Promise.allSettled`   | `Effect.forEach([...], (t) => Effect.either(t), { concurrency: "unbounded" })` |
| `Promise.any`          | `Effect.raceAll([...])`                                 |
| `Promise.race`         | `Effect.raceAll([...].map(Effect.either))`              |

## Semaphore

For mutual exclusion (e.g., only 1 fiber at a time accessing a resource):

```ts
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const sem = yield* Effect.makeSemaphore(1);
  yield* sem.withPermits(1)(criticalSection);
});
```

## Latch

A gate that blocks fibers until opened:

```ts
const program = Effect.gen(function* () {
  const latch = yield* Effect.makeLatch(); // Starts closed

  const fiber = yield* Effect.fork(
    latch.whenOpen(Effect.log("Proceeding!"))
  );

  yield* Effect.sleep("2 seconds");
  yield* latch.open; // Releases the fiber
});
```

## Queue

An in-memory async queue with back-pressure:

```ts
import { Effect, Queue } from "effect";

const program = Effect.gen(function* () {
  const queue = yield* Queue.bounded<string>(100);
  yield* Queue.offer(queue, "message1");
  const msg = yield* Queue.take(queue);
});
```

## PubSub

Broadcast messages to multiple subscribers:

```ts
import { Effect, PubSub, Queue } from "effect";

const program = Effect.scoped(
  Effect.gen(function* () {
    const pubsub = yield* PubSub.bounded<string>(10);
    const sub1 = yield* PubSub.subscribe(pubsub);
    const sub2 = yield* PubSub.subscribe(pubsub);

    yield* PubSub.publish(pubsub, "Hello!");

    console.log(yield* Queue.take(sub1)); // "Hello!"
    console.log(yield* Queue.take(sub2)); // "Hello!"
  })
);
```

---
See also: [[Overview]], [[Resource-Management]], [[Error-Handling]]

[[Index|⬅️ Back to Index]]
