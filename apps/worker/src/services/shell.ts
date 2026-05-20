import { Context, Effect, Layer, Data } from "effect";
import { $ as bunShell, type Subprocess } from "bun";

export class ShellError extends Data.TaggedError("ShellError")<{
  readonly message: string;
  readonly command: string;
  readonly exitCode?: number;
  readonly stderr?: string;
}> { }

export interface ShellService {
  readonly run: (args: string[]) => Effect.Effect<string, ShellError>;
  readonly runRaw: (command: string) => Effect.Effect<{ exitCode: number; stdout: string; stderr: string }, ShellError>;
  readonly spawn: (args: string[], options?: Parameters<typeof Bun.spawn>[1]) => Subprocess;
}

export const ShellService = Context.GenericTag<ShellService>("@github-app/worker/ShellService");

export const ShellServiceLive = Layer.succeed(
  ShellService,
  {
    run: (args: string[]) =>
      Effect.tryPromise({
        try: async () => {
          const proc = Bun.spawn(args, {
            stdout: "pipe",
            stderr: "pipe",
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
          });
          const text = await new Response(proc.stdout).text();
          const errText = await new Response(proc.stderr).text();
          const exitCode = await proc.exited;

          if (exitCode !== 0) {
            throw { message: `Exit code ${exitCode}`, exitCode, stderr: errText };
          }
          return text.trim();
        },
        catch: (err) => {
          const githubToken = process.env.GITHUB_TOKEN;
          const errorObj = err && typeof err === "object" ? err : {};
          const message = "message" in errorObj && typeof errorObj.message === "string" ? errorObj.message : String(err);
          const stderr = "stderr" in errorObj ? String(errorObj.stderr) : undefined;
          const exitCode = "exitCode" in errorObj && typeof errorObj.exitCode === "number" ? errorObj.exitCode : undefined;

          let sanitizedCommand = args.join(" ");
          let sanitizedMessage = message;
          let sanitizedStderr = stderr;

          if (githubToken) {
            sanitizedCommand = sanitizedCommand.replace(githubToken, "***");
            sanitizedMessage = sanitizedMessage.replace(githubToken, "***");
            sanitizedStderr = sanitizedStderr?.replace(githubToken, "***");
          }

          return new ShellError({
            message: `Command failed: ${sanitizedMessage}`,
            command: sanitizedCommand,
            exitCode,
            stderr: sanitizedStderr,
          });
        },
      }).pipe(
        Effect.timeout("5 minutes"),
        Effect.catchTag("TimeoutException", () =>
          Effect.fail(new ShellError({ message: "Command timed out after 5 minutes", command: args.join(" ").replace(process.env.GITHUB_TOKEN || "", "***") }))
        )
      ),
    runRaw: (command: string) =>
      Effect.tryPromise({
        try: async () => {
          // Use bunShell's built-in cross-platform handling
          const res = await bunShell`${command}`.env({ ...process.env, GIT_TERMINAL_PROMPT: "0" }).quiet().nothrow();
          return {
            exitCode: res.exitCode,
            stdout: res.stdout.toString(),
            stderr: res.stderr.toString(),
          };
        },
        catch: (err) => {
          const githubToken = process.env.GITHUB_TOKEN;
          const errorObj = err && typeof err === "object" ? err : {};
          const message = "message" in errorObj && typeof errorObj.message === "string" ? errorObj.message : String(err);
          const stderr = "stderr" in errorObj ? String(errorObj.stderr) : undefined;
          const exitCode = "exitCode" in errorObj && typeof errorObj.exitCode === "number" ? errorObj.exitCode : undefined;

          let sanitizedCommand = command;
          let sanitizedMessage = message;
          let sanitizedStderr = stderr;

          if (githubToken) {
            sanitizedCommand = sanitizedCommand.replace(githubToken, "***");
            sanitizedMessage = sanitizedMessage.replace(githubToken, "***");
            sanitizedStderr = sanitizedStderr?.replace(githubToken, "***");
          }

          return new ShellError({
            message: `Command failed: ${sanitizedMessage}`,
            command: sanitizedCommand,
            exitCode,
            stderr: sanitizedStderr,
          });
        },
      }).pipe(
        Effect.timeout("5 minutes"),
        Effect.catchTag("TimeoutException", () =>
          Effect.fail(new ShellError({ message: "Command timed out after 5 minutes", command: command.replace(process.env.GITHUB_TOKEN || "", "***") }))
        )
      ),
    spawn: (args: string[], options?: Parameters<typeof Bun.spawn>[1]) => Bun.spawn(args, options),
  }
);
