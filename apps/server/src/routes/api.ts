import { Effect, Data } from "effect";

class ApiError extends Data.TaggedError("ApiError")<{
  readonly message: string;
  readonly cause?: unknown;
}> { }
import {
  deployments,
  projectRepositories,
  projects,
  projectEnvs,
} from "@github-app/core";
import { eq, desc, and, or, isNull, asc } from "drizzle-orm";
import { DatabaseService, CryptoService } from "../services";

// --- Get All Deployments (grouped by project+branch) ---

export const getDeployments = Effect.gen(function* () {
  const { db } = yield* DatabaseService;

  const allDeployments = yield* Effect.tryPromise({
    try: () =>
      db
        .select({
          id: deployments.id,
          branch: deployments.branch,
          status: deployments.status,
          url: deployments.previewUrl,
          repo: projectRepositories.repoFullName,
          createdAt: deployments.createdAt,
          projectId: deployments.projectId,
          commitSha: deployments.commitSha,
          commitMessage: deployments.commitMessage,
          framework: deployments.framework,
          logs: deployments.logs,
        })
        .from(deployments)
        .innerJoin(
          projectRepositories,
          eq(deployments.repositoryId, projectRepositories.id)
        )
        .orderBy(desc(deployments.createdAt)),
    catch: (cause) => new ApiError({ message: `Failed to fetch deployments`, cause }),
  });

  // Group by projectId + branch
  const grouped = allDeployments.reduce<
    Record<
      string,
      {
        id: string;
        branch: string;
        projectId: string;
        repo: string;
        items: typeof allDeployments;
      }
    >
  >((acc, dep) => {
    const key = `${dep.projectId}-${dep.branch}`;
    if (!acc[key]) {
      acc[key] = {
        id: key,
        branch: dep.branch,
        projectId: dep.projectId,
        repo: dep.repo,
        items: [],
      };
    }
    acc[key].items.push(dep);
    return acc;
  }, {});

  return Object.values(grouped);
});

// --- Get All Projects ---

export const getProjects = Effect.gen(function* () {
  const { db } = yield* DatabaseService;
  return yield* Effect.tryPromise({
    try: () => db.select().from(projects),
    catch: (cause) => new ApiError({ message: `Failed to fetch projects`, cause }),
  });
});

// --- Get Single Project ---

export const getProject = (id: string) =>
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const [project] = yield* Effect.tryPromise({
      try: () =>
        db.select().from(projects).where(eq(projects.id, id)).limit(1),
      catch: (cause) => new ApiError({ message: `Failed to fetch project`, cause }),
    });
    return project;
  });

// --- Get Project Branches ---

export const getProjectBranches = (id: string) =>
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const results = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ branch: deployments.branch })
          .from(deployments)
          .where(eq(deployments.projectId, id))
          .groupBy(deployments.branch),
      catch: (cause) => new ApiError({ message: `Failed to fetch branches`, cause }),
    });
    return results.map((r) => r.branch);
  });

// --- Get Project Envs ---

export const getProjectEnvs = (id: string, branch?: string) =>
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const crypto = yield* CryptoService;

    const results = yield* (branch
      ? Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(projectEnvs)
            .where(
              and(
                eq(projectEnvs.projectId, id),
                or(isNull(projectEnvs.branch), eq(projectEnvs.branch, branch))
              )
            )
            .orderBy(asc(projectEnvs.branch)),
        catch: (cause) => new ApiError({ message: `Failed to fetch envs for branch`, cause }),
      })
      : Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(projectEnvs)
            .where(eq(projectEnvs.projectId, id)),
        catch: (cause) => new ApiError({ message: `Failed to fetch all envs`, cause }),
      }));

    // Decrypt values
    const decrypted = yield* Effect.all(
      results.map((env) =>
        crypto.decrypt(env.value).pipe(
          Effect.map((decryptedValue) => ({
            ...env,
            value: decryptedValue,
          }))
        )
      ),
      { concurrency: 10 }
    );

    return decrypted;
  });
