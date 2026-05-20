import { Effect } from "effect";
import { $ } from "bun";
import { RedisService } from "../services";
import { DockerError, PortAllocationError } from "../errors";

// --- Port Allocation (Development Mode) ---

export const findAndReservePort = (commitSha: string) =>
  Effect.gen(function* () {
    const redis = yield* RedisService;

    const minPort = Number(process.env.PREVIEW_PORT_MIN) || 5001;
    const maxPort = Number(process.env.PREVIEW_PORT_MAX) || 6000;

    for (let port = minPort; port < maxPort; port++) {
      // 1. Try to reserve in Redis (atomic NX)
      const isReserved = yield* redis.set(
        `port:reserved:${port}`,
        commitSha,
        "EX",
        60,
        "NX"
      );
      if (!isReserved) continue;

      // 2. Check if host port is physically free
      const foundPort = yield* Effect.gen(function* () {
        // 2. Check if host port is physically free
        yield* Effect.try({
          try: () => {
            const server = Bun.serve({ port, fetch: () => new Response() });
            server.stop();
          },
          catch: (error) =>
            new PortAllocationError({
              message: `Port ${port} physically bound`,
              rangeStart: minPort,
              rangeEnd: maxPort,
              cause: error,
            }),
        });

        // 3. Check Docker doesn't have it bound
        const dockerCheck = yield* Effect.tryPromise({
          try: () => $`docker ps --format "{{.Ports}}"`.text(),
          catch: () => new DockerError({ message: "Failed to check docker ports", command: "docker ps" }),
        }).pipe(Effect.orDie);

        if (dockerCheck.includes(`:${port}->`)) {
          return yield* Effect.fail("bound");
        }

        return port;
      }).pipe(
        Effect.catchAll(() =>
          Effect.gen(function* () {
            yield* Effect.logDebug(`Port ${port} is bound, skipping...`);
            yield* redis.del(`port:reserved:${port}`);
            return null;
          })
        )
      );

      if (foundPort !== null) return foundPort;
    }

    return yield* new PortAllocationError({
      message: `No available ports in range ${minPort}-${maxPort}`,
      rangeStart: minPort,
      rangeEnd: maxPort,
    });
  });
