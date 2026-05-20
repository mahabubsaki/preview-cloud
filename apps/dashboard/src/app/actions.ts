"use server";

import { Effect } from "effect";
import {
  projectEnvs,
  deployments,
  projectRepositories,
} from "@github-app/core";
import { eq, desc, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { DatabaseService, QueueService, CryptoService } from "@/lib/services";
import { Data } from "effect";

class ActionError extends Data.TaggedError("ActionError")<{
  readonly message: string;
}> {}
import { runAction } from "@/lib/runtime";

// ─── Save Project Envs ──────────────────────────────────────

const saveProjectEnvsEffect = (
  projectId: string,
  envs: { key: string; value: string; branch?: string | null }[]
) =>
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const queues = yield* QueueService;
    const crypto = yield* CryptoService;

    // 1. Delete existing ENVs for this project (clean sync)
    yield* Effect.tryPromise({
      try: () =>
        db.delete(projectEnvs).where(eq(projectEnvs.projectId, projectId)),
      catch: (err) => new Error(`Failed to delete existing envs: ${err}`),
    });

    // 2. Encrypt and Insert the new set of ENVs
    const filteredEnvs = envs.filter((env) => env.key.trim() !== "");
    
    const valuesToInsert = yield* Effect.forEach(
      filteredEnvs,
      (env) =>
        crypto.encrypt(env.value).pipe(
          Effect.map((encryptedValue) => ({
            projectId,
            key: env.key.trim(),
            value: encryptedValue,
            branch: env.branch?.trim() || null,
          }))
        ),
      { concurrency: 5 }
    );

    if (valuesToInsert.length > 0) {
      yield* Effect.tryPromise({
        try: () => db.insert(projectEnvs).values(valuesToInsert),
        catch: (err) => new Error(`Failed to insert envs: ${err}`),
      });
    }

    // 3. Auto-redeploy affected branches
    const hasGlobal = envs.some((e) => !e.branch || e.branch.trim() === "");
    const affectedBranches = new Set(
      envs.map((e) => e.branch?.trim()).filter(Boolean)
    );

    const allDeployments = yield* Effect.tryPromise({
      try: async () =>
        await db
          .select()
          .from(deployments)
          .where(eq(deployments.projectId, projectId))
          .orderBy(desc(deployments.createdAt)),
      catch: (err) => new ActionError({ message: `Failed to fetch deployments: ${err}` }),
    });

    // Group by branch → take only the latest for each
    const latestByBranch = new Map<
      string,
      typeof deployments.$inferSelect
    >();
    for (const dep of allDeployments) {
      if (!latestByBranch.has(dep.branch)) {
        latestByBranch.set(dep.branch, dep);
      }
    }

    const deploymentsToRestart = Array.from(latestByBranch.values()).filter(
      (dep) => {
        if (hasGlobal) return true;
        return affectedBranches.has(dep.branch);
      }
    );

    // 4. Queue rebuild jobs for affected deployments
    yield* Effect.forEach(
      deploymentsToRestart,
      (dep) =>
        Effect.gen(function* () {
          const repos = yield* Effect.tryPromise({
            try: async () =>
              await db
                .select()
                .from(projectRepositories)
                .where(eq(projectRepositories.id, dep.repositoryId))
                .limit(1),
            catch: (err) => new ActionError({ message: `Failed to fetch repo: ${err}` }),
          });
          const repo = repos[0];
          if (!repo) return;

          yield* Effect.log(
            `🔄 [ACTION] Triggering redeploy for ${repo.repoFullName} [${dep.branch}]`
          );

          yield* queues.addBuild(
            `redeploy-${dep.commitSha}-${Date.now()}`,
            {
              deploymentId: dep.id,
              projectId,
              repo: repo.repoFullName,
              branch: dep.branch,
              commitSha: dep.commitSha,
              author: "System (Env Update)",
              message: `Redeploying branch "${dep.branch}" with updated configurations`,
            }
          );
        }),
      { concurrency: 5 }
    );
  });

export async function saveProjectEnvs(
  projectId: string,
  envs: { key: string; value: string; branch?: string | null }[]
) {
  try {
    await runAction(saveProjectEnvsEffect(projectId, envs));
    revalidatePath(`/projects/${projectId}`);
    return { success: true };
  } catch (error) {
    console.error("Failed to save ENVs:", error);
    return { success: false, error: "Internal Server Error" };
  }
}

// ─── Teardown Deployment ─────────────────────────────────────

const teardownDeploymentEffect = (projectId: string, branch: string) =>
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const queues = yield* QueueService;

    yield* Effect.log(
      `📡 [ACTION] Teardown requested for Project: ${projectId}, Branch: ${branch}`
    );

    // 1. Queue the delete job
    yield* queues.addDelete(`manual-delete-${projectId}-${branch}`, {
      projectId,
      branch,
    });

    // 2. Remove DB records
    yield* Effect.tryPromise({
      try: () =>
        db
          .delete(deployments)
          .where(
            and(
              eq(deployments.projectId, projectId),
              eq(deployments.branch, branch)
            )
          ),
      catch: (err) => new ActionError({ message: `Failed to delete deployment records: ${err}` }),
    });

    yield* Effect.log("✅ [ACTION] Teardown complete");
  });

export async function teardownDeployment(projectId: string, branch: string) {
  try {
    await runAction(teardownDeploymentEffect(projectId, branch));
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("❌ [ACTION] Teardown failed:", error);
    return { success: false, error: "Failed to queue teardown" };
  }
}

// ─── Rebuild Deployment ──────────────────────────────────────

const rebuildDeploymentEffect = (commitSha: string) =>
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const queues = yield* QueueService;

    // 1. Find the deployment
    const deps = yield* Effect.tryPromise({
      try: async () =>
        await db
          .select()
          .from(deployments)
          .where(eq(deployments.commitSha, commitSha))
          .limit(1),
      catch: (err) => new ActionError({ message: `Failed to fetch deployment: ${err}` }),
    });
    const dep = deps[0];
    if (!dep) return yield* Effect.fail(new Error("Deployment not found"));

    // 2. Find the repo
    const repos = yield* Effect.tryPromise({
      try: async () =>
        await db
          .select()
          .from(projectRepositories)
          .where(eq(projectRepositories.id, dep.repositoryId))
          .limit(1),
      catch: (err) => new ActionError({ message: `Failed to fetch repo: ${err}` }),
    });
    const repo = repos[0];
    if (!repo)
      return yield* Effect.fail(new Error("Repository mapping not found"));

    // 3. Reset status to pending
    yield* Effect.tryPromise({
      try: () =>
        db
          .update(deployments)
          .set({ status: "pending" })
          .where(eq(deployments.commitSha, commitSha)),
      catch: (err) => new ActionError({ message: `Failed to update status: ${err}` }),
    });

    // 4. Queue the build
    yield* queues.addBuild(`manual-rebuild-${commitSha}-${Date.now()}`, {
      deploymentId: dep.id,
      projectId: dep.projectId,
      repo: repo.repoFullName,
      branch: dep.branch,
      commitSha: dep.commitSha,
      author: "Manual Rebuild",
      message: dep.commitMessage || "Manual Rebuild",
    });
  });

export async function rebuildDeployment(commitSha: string) {
  try {
    await runAction(rebuildDeploymentEffect(commitSha));
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("Rebuild failed:", err);
    return { success: false, error: err instanceof Error ? err.message : "Failed to rebuild" };
  }
}
