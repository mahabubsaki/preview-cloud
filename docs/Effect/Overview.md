# Effect Overview

Effect is a powerful TypeScript library for building production-grade applications. It provides a unified system for handling **side effects**, **errors**, **concurrency**, **dependency injection**, and **observability**.

## The `Effect` Type

The core type is `Effect<Success, Error, Requirements>`:
- **Success** (`A`) — the value produced on success
- **Error** (`E`) — the typed error that can occur (defaults to `never`)
- **Requirements** (`R`) — the dependencies/services the effect needs to run (defaults to `never`)

```ts
import { Effect } from "effect";

//      ┌── Success: string
//      │        ┌── Error: HttpError
//      │        │           ┌── Requirements: Database
//      ▼        ▼           ▼
type MyEffect = Effect.Effect<string, HttpError, Database>;
```

> [!TIP]
> Effect uses `never` to indicate unused type slots. `Effect<string>` means: succeeds with `string`, cannot fail, requires nothing.

## Creating Effects

| Constructor         | Description                                                   |
| ------------------- | ------------------------------------------------------------- |
| `Effect.succeed(a)` | Creates a successful effect with value `a`                    |
| `Effect.fail(e)`    | Creates a failed effect with error `e`                        |
| `Effect.sync(fn)`   | Wraps a synchronous side-effectful function                   |
| `Effect.tryPromise` | Wraps a `Promise`-returning function with error mapping       |
| `Effect.promise`    | Wraps a `Promise` that never rejects                          |
| `Effect.gen`        | Generator-based syntax (similar to `async/await`)             |

## Generator Syntax (`Effect.gen`)

The most ergonomic way to write Effect programs. Uses `yield*` instead of `await`:

```ts
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const a = yield* Effect.succeed(10);
  const b = yield* Effect.succeed(20);
  return a + b;
});

Effect.runPromise(program).then(console.log); // 30
```

> [!IMPORTANT]
> `Effect.gen` is the recommended way to write Effect code. It feels like `async/await` but with full type safety for errors and dependencies.

## Running Effects

| Runner                  | Description                                           |
| ----------------------- | ----------------------------------------------------- |
| `Effect.runPromise`     | Runs the effect and returns a `Promise<A>`            |
| `Effect.runPromiseExit` | Returns `Promise<Exit<A, E>>` (captures all outcomes) |
| `Effect.runSync`        | Runs synchronously, throws on async operations        |
| `Effect.runFork`        | Runs in a background fiber (non-blocking)             |

## Pipelines

Effect provides a fluent pipeline API using `.pipe()`:

```ts
const result = Effect.succeed("hello").pipe(
  Effect.map((s) => s.length),        // Transform success
  Effect.flatMap((n) => Effect.succeed(n * 2)), // Chain effects
  Effect.tap((n) => Effect.log(`Got: ${n}`))     // Side-effect without changing value
);
```

### Common Pipeline Operators

| Operator          | Description                                          |
| ----------------- | ---------------------------------------------------- |
| `Effect.map`      | Transform the success value                          |
| `Effect.flatMap`  | Chain to another effect                              |
| `Effect.andThen`  | Flexible chaining (accepts values, effects, promises)|
| `Effect.tap`      | Run a side-effect, keep the original value           |
| `Effect.mapError` | Transform the error value                            |

## Effect vs Promises

| Feature                | `Promise<A>`       | `Effect<A, E, R>`         |
| ---------------------- | ------------------ | ------------------------- |
| **Evaluation**         | Eager              | Lazy                      |
| **Execution**          | One-shot           | Reusable / Repeatable     |
| **Typed Errors**       | ❌                 | ✅                        |
| **Typed Dependencies** | ❌                 | ✅                        |
| **Interruption**       | Manual AbortController | Built-in, automatic    |
| **Concurrency**        | Basic (`all`, `race`) | Structured, fiber-based |
| **Retry**              | Manual             | Built-in with `Schedule`  |

## Commonly Used Functions (Starter List)

You can start being productive with just these ~15 functions:

- `Effect.succeed` / `Effect.fail` / `Effect.sync`
- `Effect.tryPromise`
- `Effect.gen`
- `Effect.runPromise`
- `Effect.map` / `Effect.flatMap` / `Effect.andThen` / `Effect.tap`
- `Effect.catchTag` / `Effect.catchAll`
- `Effect.acquireRelease` / `Effect.acquireUseRelease`
- `Effect.provide` / `Effect.provideService`

## Performance FAQ

> **"Effect is slow!"** — Effect's overhead is negligible for real application code. It performs 500x slower than `1 + 1`, but you'd never use Effect for raw arithmetic. Effect is an **app-level** framework for managing concurrency, errors, and dependencies. There are React apps running at 120fps using Effect.

> **"Bundle size is huge!"** — The minimum cost is ~25KB gzipped, which includes the full fiber runtime. Effect is tree-shaking friendly. As you use more of it, your own code becomes shorter and terser, amortizing the cost.

---
See also: [[Configuration]], [[Error-Handling]], [[Concurrency]], [[Services-and-Layers]], [[Resource-Management]]

[[Index|⬅️ Back to Index]]
