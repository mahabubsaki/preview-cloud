import { Context, Effect, Layer, Data } from "effect";
import { EnvVarListSchema } from "@github-app/core";

export class ApiError extends Data.TaggedError("ApiError")<{
  readonly message: string;
  readonly status?: number;
  readonly url: string;
}> { }

export interface InternalApiService {
  readonly fetchEnvs: (projectId: string, branch: string) => Effect.Effect<{ key: string; value: string }[], ApiError>;
}

export const InternalApiService = Context.GenericTag<InternalApiService>("@github-app/worker/InternalApiService");

export const InternalApiServiceLive = Layer.succeed(
  InternalApiService,
  {
    fetchEnvs: (projectId: string, branch: string) =>
      Effect.gen(function* () {
        const serverUrl = (process.env.INTERNAL_SERVER_URL || "http://localhost:3001").replace(/\/+$/, "");
        const url = `${serverUrl}/api/projects/${projectId}/envs?branch=${branch}`;

        yield* Effect.log(`📡 Fetching envs from: ${url}`);

        return yield* Effect.tryPromise({
          try: () => fetch(url),
          catch: (err) => new ApiError({
            message: `Failed to fetch envs: ${err instanceof Error ? err.message : String(err)}`,
            url,
          }),
        }).pipe(
          Effect.timeout("5 seconds"),
          Effect.flatMap((res) =>
            Effect.gen(function* () {
              if (!res.ok) {
                return yield* new ApiError({
                  message: `HTTP ${res.status}: ${res.statusText}`,
                  status: res.status,
                  url,
                });
              }
              const json = yield* Effect.tryPromise({
                try: () => res.json(),
                catch: (err) =>
                  new ApiError({
                    message: `Failed to parse JSON response: ${err instanceof Error ? err.message : String(err)}`,
                    url,
                  }),
              });
              return EnvVarListSchema.parse(json);
            })
          ),
          Effect.catchTag("TimeoutException", () =>
            new ApiError({
              message: `Timed out fetching envs (5s) — is the server running at ${url}?`,
              url,
            })
          )
        );
      }),
  }
);
