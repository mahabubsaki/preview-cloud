import { Effect, Context, Layer, Schedule } from "effect";
import { Octokit } from "octokit";
import { GitHubError } from "../errors";
import { $ } from "bun";

export interface GitHubService {
  readonly triggerBuild: (params: {
    repoUrl: string;
    commitSha: string;
    imageTag: string;
    buildArgs: Record<string, string>;
    deploymentId: string;
    framework: string;
  }) => Effect.Effect<void, GitHubError>;
  readonly findLatestRun: (commitSha: string) => Effect.Effect<string | null, GitHubError>;
  readonly tailLogs: (runId: string, commitSha: string) => Effect.Effect<void, GitHubError>;
  readonly deletePackageVersion: (packageName: string, tag: string) => Effect.Effect<void, GitHubError>;
  readonly cancelActiveRuns: (branch: string) => Effect.Effect<void, GitHubError>;
}

export const GitHubService = Context.GenericTag<GitHubService>("@github-app/worker/GitHubService");

export const GitHubServiceLive = Layer.effect(
  GitHubService,
  Effect.gen(function* () {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    return {
      triggerBuild: ({ repoUrl, commitSha, imageTag, buildArgs, deploymentId, framework }) =>
        Effect.tryPromise({
          try: async () => {
            const [owner, repo] = (process.env.GITHUB_BUILDER_REPO || "mahabubsaki/preview-cloud-ph").split("/");

            await octokit.request("POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches", {
              owner: owner!,
              repo: repo!,
              workflow_id: "builder.yml",
              ref: "main",
              headers: { "X-GitHub-Api-Version": "2022-11-28" },
              inputs: {
                repo_url: repoUrl,
                commit_sha: commitSha,
                image_tag: imageTag,
                build_args: JSON.stringify(buildArgs),
                callback_url: process.env.BUILD_SMEE_URL || `${process.env.INTERNAL_SERVER_URL}/api/build-complete`,
                callback_url_log: process.env.LOG_SMEE_URL || `${process.env.INTERNAL_SERVER_URL}/api/build-log`,
                deployment_id: deploymentId,
                framework: framework,
              },
            });
          },
          catch: (cause) => new GitHubError({ message: "Failed to trigger GitHub Action", operation: "triggerBuild", cause }),
        }),

      findLatestRun: (commitSha: string) =>
        Effect.tryPromise({
          try: () => $`gh run list --commit ${commitSha} --workflow builder.yml --json databaseId,status --limit 1`.json() as Promise<Array<{ databaseId: string; status: string }>>,
          catch: (cause) => new GitHubError({ message: "GH CLI lookup failed", operation: "findLatestRun", cause })
        }).pipe(
          Effect.flatMap((runs) => {
            const firstRun = runs[0];
            if (!firstRun) {
              return Effect.fail(new GitHubError({ message: "Run not yet appeared", operation: "findLatestRun" }));
            }
            return Effect.succeed(firstRun.databaseId);
          }),
          Effect.retry({
            // Increase to 20 retries (60 seconds total) as GitHub can be slow
            schedule: Schedule.spaced("3 seconds").pipe(Schedule.compose(Schedule.recurs(20))),
          }),
          Effect.catchTag("GitHubError", (err) => 
            err.message === "Run not yet appeared" 
              ? Effect.logWarning("⚠️ Run not yet appeared. Logs might be delayed.").pipe(Effect.as(null)) 
              : Effect.fail(err)
          )
        ),

      tailLogs: (runId: string, _commitSha: string) =>
        Effect.gen(function* () {
          yield* Effect.log(`⏳ Watching run ${runId} for completion...`);

          yield* Effect.tryPromise({
            try: () => $`gh run watch ${runId} --exit-status`.quiet(),
            catch: (cause) => new GitHubError({ 
              message: "Run failed or watch error", 
              operation: "tailLogs", 
              cause 
            }),
          });

          yield* Effect.log(`✅ Run ${runId} completed.`);
        }).pipe(Effect.scoped),

      deletePackageVersion: (packageName, tag) =>
        Effect.tryPromise({
          try: async () => {
            const [owner] = (process.env.GITHUB_BUILDER_REPO || "mahabubsaki/preview-cloud-ph").split("/");
            const { data: versions } = await octokit.request("GET /orgs/{org}/packages/{package_type}/{package_name}/versions", {
              org: owner!,
              package_type: "container",
              package_name: packageName,
            });

            const version = versions.find((v) => v.metadata?.container?.tags?.includes(tag));
            if (version) {
              await octokit.request("DELETE /orgs/{org}/packages/{package_type}/{package_name}/versions/{version_id}", {
                org: owner!,
                package_type: "container",
                package_name: packageName,
                version_id: version.id,
              });
            }
          },
          catch: (cause) => new GitHubError({ message: "Failed to delete package version", operation: "deletePackageVersion", cause }),
        }),

      cancelActiveRuns: (branch: string) =>
        Effect.gen(function* () {
          yield* Effect.log(`🔍 Checking for active builds to cancel on branch: ${branch}`);
          
          const runs = yield* Effect.tryPromise({
            try: () => $`gh run list --branch ${branch} --workflow builder.yml --status in_progress --json databaseId`.json() as Promise<Array<{ databaseId: string }>>,
            catch: (cause) => new GitHubError({ message: "Failed to list active runs", operation: "cancelActiveRuns", cause })
          });

          for (const run of runs) {
            yield* Effect.log(`🛑 Cancelling GitHub Action run: ${run.databaseId}`);
            yield* Effect.tryPromise({
              try: () => $`gh run cancel ${run.databaseId}`.quiet(),
              catch: (cause) => new GitHubError({ message: `Failed to cancel run ${run.databaseId}`, operation: "cancelActiveRuns", cause })
            }).pipe(Effect.ignore); // Ignore errors if already cancelled
          }
        }),
    };
  })
);
