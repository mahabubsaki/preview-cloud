export type DeploymentStatus = "pending" | "building" | "running" | "stopped" | "failed";
export interface Deployment { id: string; projectId: string; branch: string; commitSha: string; status: DeploymentStatus; previewUrl?: string; }
