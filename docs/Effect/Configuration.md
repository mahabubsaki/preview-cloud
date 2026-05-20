# Effect Configuration

Effect provides a dedicated `Config` module for loading, validating, and composing configuration from environment variables, JSON, or custom providers.

## Basic Types

| Type       | Description                                              |
| ---------- | -------------------------------------------------------- |
| `string`   | Reads a value as a string                                |
| `number`   | Reads a value as a floating-point number                 |
| `boolean`  | Reads a value as a boolean                               |
| `integer`  | Reads a value as an integer                              |
| `date`     | Parses a value into a `Date` object                      |
| `duration` | Parses a value as a time duration                        |
| `redacted` | Reads a **sensitive value**, hidden when logged           |
| `url`      | Parses a value as a valid URL                            |
| `logLevel` | Reads a value as a log level                             |

## Loading Config from Environment Variables

```ts
import { Effect, Config } from "effect";

const program = Effect.gen(function* () {
  const host = yield* Config.string("HOST");
  const port = yield* Config.number("PORT");
  console.log(`Server: ${host}:${port}`);
});

// Run: HOST=localhost PORT=8080 npx tsx app.ts
```

If a variable is missing, you get a typed error:
```
(Missing data at HOST: "Expected HOST to exist in the process context")
```

## Default Values

```ts
const port = yield* Config.number("PORT").pipe(Config.withDefault(8080));
```

## Handling Secrets with `Config.redacted`

Use `Config.redacted` for sensitive values like API keys and tokens:

```ts
import { Effect, Config, Redacted } from "effect";

const program = Effect.gen(function* () {
  const apiKey = yield* Config.redacted("API_KEY");

  console.log(`Key: ${apiKey}`);           // Output: Key: <redacted>
  console.log(Redacted.value(apiKey));     // Output: the-actual-secret
});
```

> [!IMPORTANT]
> Always use `Config.redacted` for `GITHUB_PRIVATE_KEY`, `DISCORD_BOT_TOKEN`, `DATABASE_URL`, and other secrets. This prevents accidental leakage in logs.

## Combining Configurations

Use `Config.all` to load multiple configs at once:

```ts
const config = Config.all({
  host: Config.string("HOST"),
  port: Config.number("PORT"),
  debug: Config.boolean("DEBUG").pipe(Config.withDefault(false))
});
```

### Array / Set / Map Configs

| Combinator     | Description                                  |
| -------------- | -------------------------------------------- |
| `Config.array`   | Parses comma-separated values into an array |
| `Config.hashSet` | Parses into a deduplicated set              |
| `Config.hashMap` | Parses prefixed env vars into a key-value map|

```ts
// TAGS=web,api,worker → ["web", "api", "worker"]
const tags = yield* Config.array(Config.string(), "TAGS");
```

## Nested Configuration (Namespaces)

Group configs under namespaces using `Config.nested`:

```ts
const serverConfig = Config.all({
  host: Config.string("HOST"),
  port: Config.number("PORT")
});

const config = Config.nested(serverConfig, "SERVER");
// Expects: SERVER_HOST and SERVER_PORT
```

## Custom Config Providers

### From a Map (great for testing)

```ts
import { ConfigProvider, Effect } from "effect";

const mockProvider = ConfigProvider.fromMap(new Map([
  ["HOST", "localhost"],
  ["PORT", "8080"]
]));

Effect.runPromise(
  Effect.withConfigProvider(program, mockProvider)
);
```

### From JSON

```ts
const jsonProvider = ConfigProvider.fromJson({
  SERVER: { HOST: "localhost", PORT: 8080 }
});
```

### From Environment (with custom delimiters)

```ts
const envProvider = ConfigProvider.fromEnv({
  pathDelim: "__",  // SERVER__HOST instead of SERVER_HOST
  seqDelim: "|"     // Comma-separated becomes pipe-separated
});
```

## Validation

```ts
const name = yield* Config.string("NAME").pipe(
  Config.validate({
    message: "Expected at least 4 characters",
    validation: (s) => s.length >= 4
  })
);
```

## Schema-Based Config

You can use `Schema.Config` for more complex validation:

```ts
import { Schema } from "effect";

const myConfig = Schema.Config(
  "API_URL",
  Schema.String.pipe(Schema.minLength(4))
);
```

---
See also: [[Overview]], [[Services-and-Layers]]

[[Index|⬅️ Back to Index]]
