# Effect Data Types

Effect includes several important data types for building robust applications.

## `Option` — Representing Optional Values

Equivalent to `T | null` but with type-safe operations:

```ts
import { Option } from "effect";

const some = Option.some(42);        // Option.Some<number>
const none = Option.none();          // Option.None<number>

// Pattern matching
const result = Option.match(some, {
  onNone: () => "No value",
  onSome: (v) => `Got: ${v}`
});
```

## `Either` — Success or Failure (Synchronous)

Like a synchronous `Result` type:

```ts
import { Either } from "effect";

const right = Either.right(42);       // Success
const left = Either.left("error");    // Failure

const result = Either.match(right, {
  onLeft: (err) => `Error: ${err}`,
  onRight: (val) => `Value: ${val}`
});
```

> [!NOTE]
> `Either` is for synchronous computations. For async operations with dependencies, use the full `Effect` type.

## `Exit` — Full Computation Result

Captures the complete outcome of an effect execution:

```ts
import { Effect, Exit } from "effect";

const exit = await Effect.runPromiseExit(program);

Exit.match(exit, {
  onSuccess: (value) => console.log(`Success: ${value}`),
  onFailure: (cause) => console.error(`Failed:`, cause)
});
```

## `Cause` — Structured Error Information

Captures the full reason for failure, including:
- `Fail` — expected error
- `Die` — unexpected defect
- `Interrupt` — fiber was interrupted
- `Sequential` / `Parallel` — composed causes

## `Data.TaggedError` — Custom Error Types

Create tagged errors for pattern-matching with `catchTag`:

```ts
import { Data } from "effect";

class DockerBuildError extends Data.TaggedError("DockerBuildError")<{
  message: string;
  exitCode: number;
}> {}

class NetworkError extends Data.TaggedError("NetworkError")<{
  message: string;
  url: string;
}> {}
```

## `Data.TaggedEnum` — Discriminated Unions

Create type-safe discriminated unions with built-in equality:

```ts
import { Data } from "effect";

type DeploymentStatus = Data.TaggedEnum<{
  Pending: {};
  Building: { readonly progress: number };
  Running: { readonly url: string };
  Failed: { readonly error: string };
  Stopped: {};
}>;

const { Pending, Building, Running, Failed, Stopped } =
  Data.taggedEnum<DeploymentStatus>();

const status = Building({ progress: 75 });
```

## `Brand` — Nominal Typing

Prevent mixing up IDs and other values with the same underlying type:

```ts
import { Brand } from "effect";

type ProjectId = string & Brand.Brand<"ProjectId">;
const ProjectId = Brand.nominal<ProjectId>();

type DeploymentId = string & Brand.Brand<"DeploymentId">;
const DeploymentId = Brand.nominal<DeploymentId>();

// Now these are distinct types — can't mix them up
const pid = ProjectId("proj-123");
const did = DeploymentId("dep-456");
```

## `Chunk` — Immutable Arrays

High-performance immutable array type with efficient append/concat:

```ts
import { Chunk } from "effect";

const chunk = Chunk.make(1, 2, 3);
const appended = Chunk.append(chunk, 4);
const array = Chunk.toReadonlyArray(appended);
```

## `Redacted` — Sensitive Values

Wraps a value so it's hidden in logs:

```ts
import { Redacted } from "effect";

const secret = Redacted.make("my-api-key");
console.log(secret);             // <redacted>
console.log(Redacted.value(secret)); // "my-api-key"
```

---
See also: [[Overview]], [[Error-Handling]]

[[Index|⬅️ Back to Index]]
