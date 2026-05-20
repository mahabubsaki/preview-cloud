import { treaty } from "@elysiajs/eden";
import type { App } from "@github-app/server";

export const client = treaty<App>(process.env.INTERNAL_SERVER_URL || "http://localhost:3001");

// Type helpers
export type DeploymentsResponse = Awaited<ReturnType<typeof client.api.deployments.get>>["data"];
export type DeploymentGroup = NonNullable<DeploymentsResponse>[number];
export type Deployment = DeploymentGroup["items"][number];

export type ProjectResponse = Awaited<ReturnType<typeof client.api.projects.get>>["data"];
export type Project = NonNullable<ProjectResponse>[number];

export type SingleProjectResponse = Awaited<
  ReturnType<ReturnType<typeof client.api.projects>["get"]>
>["data"];
export type SingleProject = NonNullable<SingleProjectResponse>;

export type ProjectEnvsResponse = Awaited<
  ReturnType<ReturnType<typeof client.api.projects>["envs"]["get"]>
>["data"];
export type ProjectEnv = NonNullable<ProjectEnvsResponse>[number];
