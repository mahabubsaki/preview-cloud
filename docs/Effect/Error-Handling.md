# Effect Error Handling

Effect provides a rich, type-safe error management system. Errors are **first-class values** tracked at the type level — not thrown exceptions.

## Expected vs Unexpected Errors

| Type                | Description                                            | Tracked in types? |
| ------------------- | ------------------------------------------------------ | ----------------- |
| **Expected Errors** | Domain errors (e.g., `NotFound`, `Unauthorized`)       | ✅ Yes            |
| **Defects**         | Unexpected failures (e.g., null dereference, crashes)  | ❌ No (runtime)   |

## Creating Errors

### Using `Data.TaggedError` (Recommended)

The `_tag` field enables powerful pattern-matching with `catchTag`:

```ts
import { Data, Effect, Console } from "effect";

class NotFound extends Data.TaggedError("NotFound")<{
  message: string;
  resource: string;
}> {}

class Unauthorized extends Data.TaggedError("Unauthorized")<{
  message: string;
}> {}
```

### Yielding Errors in `Effect.gen`

You can `yield*` an error instance directly — no need for `Effect.fail`:

```ts
const program = Effect.gen(function* () {
  yield* new NotFound({
    message: "Deployment not found",
    resource: "deployment-abc123"
  });
});
```

## Catching Errors

### `catchAll` — Catch any error

```ts
const recovered = program.pipe(
  Effect.catchAll((error) =>
    Effect.succeed(`Recovered from: ${error.message}`)
  )
);
```

### `catchTag` — Catch by error tag (pattern matching)

```ts
const handled = program.pipe(
  Effect.catchTag("NotFound", (err) =>
    Console.error(`Not found: ${err.resource}`)
  ),
  Effect.catchTag("Unauthorized", (err) =>
    Console.error(`Access denied: ${err.message}`)
  )
);
```

### `catchTags` — Catch multiple tags at once

```ts
const handled = program.pipe(
  Effect.catchTags({
    NotFound: (err) => Console.error(`Not found: ${err.resource}`),
    Unauthorized: (err) => Console.error(`Denied: ${err.message}`)
  })
);
```

## Retries with `Schedule`

Effect makes it trivial to add retry logic with exponential backoff:

```ts
import { Effect, Schedule } from "effect";

const retried = Effect.retry(fetchData, {
  schedule: Schedule.exponential("1 second").pipe(
    Schedule.compose(Schedule.recurs(3))
  )
});
```

### Common Schedules

| Schedule                        | Description                            |
| ------------------------------- | -------------------------------------- |
| `Schedule.recurs(n)`            | Retry `n` times                        |
| `Schedule.spaced("2 seconds")`  | Fixed delay between retries            |
| `Schedule.exponential("1 sec")` | Exponential backoff                    |
| `Schedule.forever`              | Retry indefinitely                     |

### Retry only on specific errors

```ts
const retried = program.pipe(
  Effect.retry({
    schedule: Schedule.recurs(3),
    while: (err) => err._tag === "NetworkError"
  })
);
```

## Timeouts

```ts
const withTimeout = program.pipe(
  Effect.timeout("30 seconds")
);
```

## `Effect.either` — Convert to `Either`

Convert an effect into one that always succeeds with `Either<A, E>`:

```ts
const safe = Effect.either(program);
// Effect<Either<A, E>, never, R>
```

## `Effect.exit` — Full Result with Defects

Returns an `Exit` value that captures success, failure, and defects:

```ts
const result = yield* Effect.exit(program);
// Exit<A, E> — includes interruptions and defects
```

## Sandboxing and Cause

For advanced error inspection, `Effect.sandbox` exposes the full `Cause` of failure (including sequential/parallel composition, interruptions, and defects).

---
See also: [[Overview]], [[Concurrency]], [[Resource-Management]]

[[Index|⬅️ Back to Index]]
