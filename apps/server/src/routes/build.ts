import { Effect, Data } from "effect";
import { deployments, projectRepositories } from "@github-app/core";
import { eq } from "drizzle-orm";
import { DatabaseService, QueueService } from "../services";

interface BuildCompleteParams {
  deploymentId: string;
  status: "success" | "failed";
  image?: string;
  framework?: string;
  error?: string;
}

class BuildError extends Data.TaggedError("BuildError")<{
  readonly message: string;
  readonly cause?: unknown;
}> { }

export const handleBuildComplete = (params: BuildCompleteParams, secret?: string) =>
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const queue = yield* QueueService;

    // Security check
    const orchestratorSecret = process.env.ORCHESTRATOR_SECRET;
    if (!orchestratorSecret || secret !== orchestratorSecret) {
      return { status: "error", message: "Unauthorized: Invalid callback secret", code: 401 };
    }

    const { deploymentId, status, image, framework } = params;

    yield* Effect.log(`🏗️ Received build completion for ${deploymentId}: ${status}`);

    if (status === "failed") {
      yield* Effect.tryPromise({
        try: () =>
          db.update(deployments).set({ status: "failed" }).where(eq(deployments.id, deploymentId)),
        catch: (cause) => new BuildError({ message: "Failed to update deployment status", cause }),
      });
      return { status: "processed", message: "Build failure recorded" };
    }

    if (!image) {
      return { status: "error", message: "Missing image for successful build" };
    }

    // Fetch deployment details to requeue
    const [deployment] = yield* Effect.tryPromise({
      try: () =>
        db
          .select({
            id: deployments.id,
            projectId: deployments.projectId,
            branch: deployments.branch,
            commitSha: deployments.commitSha,
            message: deployments.commitMessage,
            repo: projectRepositories.repoFullName,
            discordMessageId: deployments.discordMessageId,
            discordChannelId: deployments.discordChannelId,
          })
          .from(deployments)
          .innerJoin(projectRepositories, eq(deployments.repositoryId, projectRepositories.id))
          .where(eq(deployments.id, deploymentId))
          .limit(1),
      catch: (cause) => new BuildError({ message: "Failed to fetch deployment", cause }),
    });

    if (!deployment) {
      return { status: "error", message: "Deployment not found" };
    }

    // Re-queue to BUILD_QUEUE with the image field
    yield* queue.addBuild(`launch-${deployment.id}`, {
      deploymentId: deployment.id,
      projectId: deployment.projectId,
      repo: deployment.repo,
      branch: deployment.branch,
      commitSha: deployment.commitSha,
      author: "GitHub Actions",
      message: deployment.message || "",
      image,
      framework,
      discordMessageId: deployment.discordMessageId || undefined,
      discordChannelId: deployment.discordChannelId || undefined,
    });

    yield* Effect.log(`🚀 Queued launch for ${deployment.repo}@${deployment.branch} with image ${image}`);

    return { status: "processed", message: "Launch queued" };
  });
