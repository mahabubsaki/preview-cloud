import { Effect, Layer, ManagedRuntime } from "effect";
import { Elysia, NotFoundError, t } from "elysia";
import { cors } from "@elysiajs/cors";
import IORedis from "ioredis";
import { EventEmitter } from "events";
import { sse } from "elysia";
import { openapi, fromTypes } from "@elysia/openapi";

import {
  // DatabaseService,
  DatabaseServiceLive,
  RedisService,
  RedisServiceLive,
  // QueueService,
  QueueServiceLive,
  // WebhookService,
  WebhookServiceLive,
  // PubSubService — replaced by shared EventEmitter subscriber
  // PubSubServiceLive,
  CryptoServiceLive,
} from "./services";

import { handleWebhook } from "./routes/webhook";
import { AppError } from "./errors";
import {
  getDeployments,
  getProjects,
  getProject,
  getProjectBranches,
  getProjectEnvs,
} from "./routes/api";
import { createNotifyWorker } from "./workers/notify";
import { handleBuildComplete } from "./routes/build";

// --- Compose All Layers ---

// We explicitly provide Redis to Queue and merge everything into a single satisfied layer
const AppLayer = DatabaseServiceLive().pipe(
  Layer.merge(RedisServiceLive),
  Layer.merge(WebhookServiceLive),
  Layer.merge(CryptoServiceLive),
  Layer.merge(QueueServiceLive.pipe(Layer.provide(RedisServiceLive)))
);

// --- Shared Redis PubSub Subscriber (single connection for all SSE clients) ---

const sseEmitter = new EventEmitter();
const subRedis = new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
subRedis.subscribe("deployment-updates").then(() => {
  console.log("✅ Shared Redis PubSub subscriber initialized");
});
subRedis.on("message", (_channel, message) => {
  sseEmitter.emit("message", message);
});
subRedis.on("error", (err) => {
  console.error("❌ Redis PubSub Error:", err);
});

// --- ManagedRuntime for Elysia integration ---

const runtime = ManagedRuntime.make(AppLayer);

// Helper to run Effect inside Elysia handlers
const runEffect = <A, E>(effect: Effect.Effect<A, E, Layer.Layer.Success<typeof AppLayer>>): Promise<A> =>
  runtime.runPromise(effect).catch((err) => {
    // If it's already an AppError, rethrow it
    if (err instanceof AppError) throw err;
    
    // Map Effect Tagged Errors to AppErrors
    if (err && typeof err === "object" && "_tag" in err) {
      const message = "message" in err && typeof err.message === "string" ? err.message : "Operation failed";
      const code = typeof err._tag === "string" ? err._tag : "INTERNAL_ERROR";
      throw new AppError(message, code, 500);
    }

    // Default fallback
    throw new AppError(
      err instanceof Error ? err.message : String(err),
      "INTERNAL_SERVER_ERROR",
      500
    );
  });

// --- Elysia App ---

const app = new Elysia()
  .use(cors({
    origin: [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3001"
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-hub-signature-256", "x-github-event", "x-webhook-secret", "x-callback-secret"],
    credentials: true,
  }))
  .onError(({ code, error, set }) => {
    // Handle our custom AppErrors
    if (error instanceof AppError) {
      set.status = error.status;
      return {
        status: "error",
        code: error.code,
        message: error.message,
        data: error.data
      };
    }

    // Handle Elysia internal errors (Validation, etc.)
    if (code === 'VALIDATION') {
      set.status = 400;
      return {
        status: "error",
        code: "VALIDATION_ERROR",
        message: "Invalid request data",
        details: 'all' in error ? error.all : error
      };
    }

    if (code === 'NOT_FOUND') {
      set.status = 404;
      return {
        status: "error",
        code: "NOT_FOUND",
        message: "Route not found"
      };
    }

    // Global Fallback
    console.error("🔥 Unhandled Server Error:", error);
    set.status = 500;
    
    const message = 'message' in error ? error.message : "An unexpected error occurred";
    
    return {
      status: "error",
      code: "INTERNAL_SERVER_ERROR",
      message
    };
  })
  .use(
    openapi({
      references: fromTypes(),
      documentation: {
        info: {
          title: "Preview.Cloud PH API",
          version: "1.0.0",
        },
        tags: [
          { name: "Deployments", description: "Deployment management" },
          { name: "Projects", description: "Project management" },
          { name: "Webhooks", description: "GitHub webhook handlers" },
        ],
      },
    })
  )
  .get("/", () => "GitHub App Server is Running 🚀")

  // SSE endpoint — uses a shared Redis subscriber via EventEmitter
  .get("/api/events", async function* ({ request }) {
    console.log("📡 New SSE connection established");

    // Each SSE client gets its own bounded message queue (max 256 entries)
    const messages: string[] = [];
    const MAX_BUFFER = 256;

    const listener = (message: string) => {
      if (messages.length < MAX_BUFFER) {
        messages.push(message);
      }
    };

    sseEmitter.on("message", listener);

    yield sse({ data: { type: "connected" } });

    let heartbeatCount = 0;

    try {
      while (!request.signal.aborted) {
        // Drain pending messages
        let msg: string | undefined;
        while ((msg = messages.shift()) !== undefined) {
          try {
            const data = JSON.parse(msg);
            console.log("📤 Broadcasting update:", data.commitSha);
            yield sse({ data });
          } catch (e) {
            console.error("❌ Failed to parse Redis message:", msg);
          }
        }

        // Heartbeat every ~15 seconds (150 × 100ms)
        heartbeatCount++;
        if (heartbeatCount >= 150) {
          yield sse({ data: { type: "heartbeat", timestamp: Date.now() } });
          heartbeatCount = 0;
        }

        await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      sseEmitter.off("message", listener);
      console.log("🧹 SSE subscription cleaned up");
    }
  })

  // Webhook endpoint
  .post("/webhooks", async ({ request }) => {
    const signature = request.headers.get("x-hub-signature-256");
    const event = request.headers.get("x-github-event");
    const rawBody = await request.text();

    return await runEffect(
      handleWebhook({ rawBody, signature, event })
    );
  }, {
    detail: {
      tags: ["Webhooks"],
      summary: "Handle GitHub webhooks (secure raw-body verification)",
    }
  })

  // Build Completion callback from GitHub Actions
  .post("/api/build-complete", async ({ body, headers }) => {
    const secret = headers["x-callback-secret"];
    return await runEffect(handleBuildComplete(body, secret));
  }, {
    body: t.Object({
      deploymentId: t.String(),
      status: t.Union([t.Literal("success"), t.Literal("failed")]),
      image: t.Optional(t.String()),
      framework: t.Optional(t.String()),
      error: t.Optional(t.String()),
    }),
    detail: {
      tags: ["Internal"],
      summary: "Callback for GitHub Actions build completion",
    }
  })

  // Build Log callback for real-time streaming
  .post("/api/build-log", async ({ body, headers,set }) => {
    const secret = (headers)["x-callback-secret"] || (headers)["X-Callback-Secret"];
    console.log("Building log", body);
    
    return await runEffect(
      Effect.gen(function* () {
        const redis = yield* RedisService;

        // Security check
        const orchestratorSecret = process.env.ORCHESTRATOR_SECRET?.trim();
        const incomingSecret = secret?.trim();

        if (!orchestratorSecret || incomingSecret !== orchestratorSecret) {
    set.status = 401;
          return { status: "error", message: "Unauthorized: Invalid callback secret"};
        }

        const commitSha = body.commitSha.trim();
        const log = body.log;
        const shortSha = commitSha.substring(0, 7);
        
        const channelFull = `logs:${commitSha}`;
        const channelShort = `logs:${shortSha}`;
        const historyKey = `logs:history:${commitSha}`;

        if (log) {
          process.stdout.write("."); // Progress indicator for logs
          yield* redis.publish(channelFull, log).pipe(Effect.ignore);
          yield* redis.publish(channelShort, log).pipe(Effect.ignore);
          yield* redis.rpush(historyKey, log).pipe(Effect.ignore);
        }
        return { status: "accepted" };
      })
    );
  }, {
    body: t.Object({
      deploymentId: t.String(),
      commitSha: t.String(),
      log: t.String(),
    }),
    detail: {
      tags: ["Internal"],
      summary: "Endpoint for streaming real-time log lines from GitHub Actions",
    }
  })

  // API routes
  .get("/api/deployments", async () => {
    return await runEffect(getDeployments);
  }, {
    response: {
      200: t.Array(t.Object({
        id: t.String(),
        branch: t.String(),
        projectId: t.String(),
        repo: t.String(),
        items: t.Array(t.Object({
          id: t.String(),
          branch: t.String(),
          status: t.Union([
            t.Literal("pending"),
            t.Literal("building"),
            t.Literal("running"),
            t.Literal("stopped"),
            t.Literal("failed"),
          ]),
          url: t.Nullable(t.String()),
          repo: t.String(),
          createdAt: t.Date(),
          projectId: t.String(),
          commitSha: t.String(),
          commitMessage: t.Nullable(t.String()),
          framework: t.Nullable(t.String()),
          logs: t.Nullable(t.String()),
        }))
      })),
      500: t.Object({ error: t.String() })
    },
    detail: {
      tags: ["Deployments"],
      summary: "Get all deployments grouped by project and branch",
    }
  })
  .get("/api/projects", async () => {
    return await runEffect(getProjects);
  }, {
    response: {
      200: t.Array(t.Object({
        id: t.String(),
        name: t.String(),
        createdAt: t.Date(),
      })),
      500: t.Object({ error: t.String() })
    },
    detail: {
      tags: ["Projects"],
      summary: "List all projects",
    }
  })
  .get(
    "/api/projects/:id",
    async ({ params }) => {
      const project = await runEffect(getProject(params.id));
      if (!project) throw new NotFoundError("Project not found");
      return project;
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Object({
          id: t.String(),
          name: t.String(),
          createdAt: t.Date(),
        }),
        404: t.String(),
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Projects"],
        summary: "Get a project by ID",
      }
    }
  )
  .get(
    "/api/projects/:id/branches",
    async ({ params }) => {
      return await runEffect(getProjectBranches(params.id));
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Array(t.String()),
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Projects"],
        summary: "List all active branches for a project",
      }
    }
  )
  .get(
    "/api/projects/:id/envs",
    async ({ params, query }) => {
      return await runEffect(getProjectEnvs(params.id, query.branch));
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({ branch: t.Optional(t.String()) }),
      response: {
        200: t.Array(t.Object({
          id: t.String(),
          projectId: t.String(),
          key: t.String(),
          value: t.String(),
          branch: t.Nullable(t.String()),
          createdAt: t.Date(),
        })),
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Projects"],
        summary: "Get decrypted environment variables for a project or branch",
      }
    }
  )
  .listen(3001);

// Export type for Eden Treaty
export type App = typeof app;

// --- Start Background Workers ---

runEffect(createNotifyWorker).catch((err) =>
  console.error("❌ Failed to start notify worker:", err)
);

console.log("🦊 GitHub App Server is active (Effect-TS)");
