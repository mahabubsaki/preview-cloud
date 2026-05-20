import { Effect, Data, Schema as S } from "effect";

class WebhookError extends Data.TaggedError("WebhookError")<{
  readonly message: string;
  readonly cause?: unknown;
}> { }
import {
  projectRepositories,
  projects,
  deployments,
  type DeploymentJob,
} from "@github-app/core";
import { eq, and, inArray } from "drizzle-orm";
import { DatabaseService, WebhookService, QueueService } from "../services";

// --- Webhook Handler ---

const WebhookBody = S.Struct({
  ref: S.String,
  ref_type: S.optional(S.String),
  after: S.optional(S.String),
  repository: S.Struct({
    full_name: S.String,
  }),
  pusher: S.optional(S.Struct({
    email: S.String,
  })),
  head_commit: S.optional(S.Struct({
    message: S.String,
  })),
});

type WebhookBody = S.Schema.Type<typeof WebhookBody>;


interface WebhookParams {
  rawBody: string;
  signature: string | null;
  event: string | null;
}

export const handleWebhook = (params: WebhookParams) =>
  Effect.gen(function* () {
    const { rawBody, signature, event } = params;

    // 1. Validate headers
    if (!signature || !event) {
      return { error: "Missing headers", status: 400 };
    }

    // 2. Verify signature
    const webhookSvc = yield* WebhookService;

    yield* Effect.log(`🔍 Verifying webhook: event=${event}, signature=${signature}`);

    const isValid = yield* webhookSvc.verify(rawBody, signature);
    yield* Effect.log(`⚖️ Verification result: ${isValid}`);

    if (!isValid) {
      return { error: "Invalid signature", status: 401 };
    }

    // 3. Parse body
    const body = yield* S.decodeUnknown(S.parseJson(WebhookBody))(rawBody).pipe(
      Effect.catchAll(() => Effect.succeed({ error: "Invalid JSON payload or structure", status: 400 }))
    );

    if (body && typeof body === "object" && "error" in body) {
      return body;
    }

    // 4. Handle push events
    if (event === "push") {
      yield* handlePushEvent(body);
    }

    // 5. Handle delete events
    if (event === "delete") {
      yield* handleDeleteEvent(body);
    }

    return { status: "accepted" };
  });

// --- Push Event Handler ---

const handlePushEvent = (body: WebhookBody) =>
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const queue = yield* QueueService;

    const repoFullName = body.repository.full_name;
    const branch = body.ref.replace("refs/heads/", "");
    const commitSha = body.after || "";

    // Find or create project + repo mapping
    let [repoMapping] = yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(projectRepositories)
          .where(eq(projectRepositories.repoFullName, repoFullName))
          .limit(1),
      catch: (cause) => new WebhookError({ message: `DB query failed`, cause }),
    });

    if (!repoMapping) {
      const createdProjects = yield* Effect.tryPromise({
        try: () =>
          db
            .insert(projects)
            .values({ name: repoFullName.split("/")[1]! })
            .returning(),
        catch: (cause) => new WebhookError({ message: `DB insert project failed`, cause }),
      });

      const newProject = createdProjects[0];
      if (newProject) {
        const createdRepos = yield* Effect.tryPromise({
          try: () =>
            db
              .insert(projectRepositories)
              .values({
                projectId: newProject.id,
                repoFullName,
                repoType: "monorepo",
              })
              .returning(),
          catch: (cause) => new WebhookError({ message: `DB insert repo failed`, cause }),
        });
        repoMapping = createdRepos[0];
      }
    }

    if (!repoMapping) return;

    // Archive previous deployments for this branch
    yield* Effect.tryPromise({
      try: () =>
        db
          .update(deployments)
          .set({ status: "stopped" })
          .where(
            and(
              eq(deployments.projectId, repoMapping.projectId),
              eq(deployments.branch, branch)
            )
          ),
      catch: (cause) => new WebhookError({ message: `DB archive failed`, cause }),
    });

    // Create new deployment record
    // Check for existing deployment for this commit to prevent duplicates on webhook retries
    const [existing] = yield* Effect.tryPromise({
      try: () => db.select().from(deployments).where(and(eq(deployments.commitSha, commitSha), inArray(deployments.status, ["pending", "building", "running", "failed"]))).limit(1),
      catch: (cause) => new WebhookError({ message: `DB query existing failed`, cause }),
    });

    if (existing) {
      yield* Effect.log(`ℹ️ Deployment for ${commitSha} already exists (status: ${existing.status}). Skipping duplicate queue.`);
      return;
    }

    // Insert new deployment record
    const [newDeployment] = yield* Effect.tryPromise({
      try: () =>
        db.insert(deployments).values({
          projectId: repoMapping.projectId,
          repositoryId: repoMapping.id,
          branch,
          commitSha,
          commitMessage: body.head_commit?.message || "No message",
          status: "pending",
        }).returning(),
      catch: (cause) => new WebhookError({ message: `DB insert deployment failed`, cause }),
    });

    if (!newDeployment) return;

    // Queue deployment job
    const jobData: DeploymentJob = {
      deploymentId: newDeployment.id,
      projectId: repoMapping.projectId,
      repo: repoFullName,
      branch,
      commitSha,
      author: body.pusher?.email || "Unknown",
      message: body.head_commit?.message || "No message",
    };

    yield* queue.addDeployment(`deploy-${newDeployment.id}`, jobData);
    yield* Effect.log(`📦 Queued deployment for ${repoFullName}@${branch}`);
  });

// --- Delete Event Handler ---

const handleDeleteEvent = (body: WebhookBody) =>
  Effect.gen(function* () {
    if (body.ref_type !== "branch") return;

    const { db } = yield* DatabaseService;
    const queue = yield* QueueService;

    const branch = body.ref;
    const repoFullName = body.repository.full_name;

    const [repoMapping] = yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(projectRepositories)
          .where(eq(projectRepositories.repoFullName, repoFullName))
          .limit(1),
      catch: (cause) => new WebhookError({ message: `DB query failed for delete event`, cause }),
    });

    if (repoMapping) {
      yield* queue.addDelete(
        `delete-${repoMapping.projectId}-${branch}`,
        { projectId: repoMapping.projectId, branch }
      );
      yield* Effect.log(`🗑️ Queued branch delete for ${repoFullName}/${branch}`);
    }
  });
