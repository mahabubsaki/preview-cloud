import { z } from "zod";

export const DEPLOYMENT_QUEUE = "deployment-queue";
export const BUILD_QUEUE = "build-queue";
export const NOTIFY_QUEUE = "notify-queue";
export const DELETE_QUEUE = "delete-queue";

export const DeploymentJobSchema = z.object({
  deploymentId: z.string().uuid(),
  projectId: z.string().uuid(),
  repo: z.string(),
  branch: z.string(),
  commitSha: z.string(),
  author: z.string(),
  message: z.string(),
});

export type DeploymentJob = z.infer<typeof DeploymentJobSchema>;

export const BuildJobSchema = DeploymentJobSchema.extend({
  approvedBy: z.string().optional(),
  discordMessageId: z.string().optional(),
  discordChannelId: z.string().optional(),
  image: z.string().optional(), // If present, skip build and just launch
  framework: z.string().optional(),
});

export type BuildJob = z.infer<typeof BuildJobSchema>;

export const NotifyJobSchema = z.object({
  deploymentId: z.string().uuid(),
  repo: z.string(),
  branch: z.string(),
  commitSha: z.string(),
  previewUrl: z.string(),
  status: z.enum(["success", "failure"]),
  discordMessageId: z.string().optional(),
  discordChannelId: z.string().optional(),
  buildTime: z.number().optional(), // in seconds
  framework: z.string().optional(),
});

export type NotifyJob = z.infer<typeof NotifyJobSchema>;

export const DeleteJobSchema = z.object({
  projectId: z.string().uuid(),
  branch: z.string(),
});

export type DeleteJob = z.infer<typeof DeleteJobSchema>;
