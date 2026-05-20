import { Data } from "effect";

// --- Worker Domain Errors ---

export class BuildError extends Data.TaggedError("BuildError")<{
  readonly message: string;
  readonly phase: "clone" | "detect" | "docker_build" | "docker_run" | "env_fetch" | "cleanup" | "notification" | "status_update";
  readonly commitSha: string;
  readonly cause?: unknown;
}> {}

export class CleanupError extends Data.TaggedError("CleanupError")<{
  readonly message: string;
  readonly deploymentId?: string;
  readonly cause?: unknown;
}> {}

export class DiscordError extends Data.TaggedError("DiscordError")<{
  readonly message: string;
  readonly operation: "channel_fetch" | "message_send" | "interaction" | "login";
  readonly cause?: unknown;
}> {}

export class PortAllocationError extends Data.TaggedError("PortAllocationError")<{
  readonly message: string;
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly cause?: unknown;
}> {}

export class DockerError extends Data.TaggedError("DockerError")<{
  readonly message: string;
  readonly command: string;
  readonly cause?: unknown;
}> {}

export class GitHubError extends Data.TaggedError("GitHubError")<{
  readonly message: string;
  readonly operation: string;
  readonly cause?: unknown;
}> {}
