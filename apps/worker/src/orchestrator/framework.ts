import { Effect, Data } from "effect";
import path from "path";
import { readdirSync } from "node:fs";
import { PackageJsonSchema } from "@github-app/core";

// --- Errors ---
class FrameworkDetectionError extends Data.TaggedError("FrameworkDetectionError")<{
  readonly message: string;
}> {}

// --- Framework Detection ---

export interface MonorepoInfo {
  isMonorepo: boolean;
  appDir: string;
  tool: string;
}

export const detectMonorepo = (repoDir: string) =>
  Effect.gen(function* () {
    const checkFile = (filePath: string) =>
      Effect.tryPromise({
        try: () => Bun.file(filePath).exists(),
        catch: () => new FrameworkDetectionError({ message: `File check failed: ${filePath}` }),
      }).pipe(Effect.orDie);

    const hasTurborepo = yield* checkFile(path.join(repoDir, "turbo.json"));
    const hasNxJson = yield* checkFile(path.join(repoDir, "nx.json"));
    const hasPnpmWs = yield* checkFile(path.join(repoDir, "pnpm-workspace.yaml"));
    const hasLerna = yield* checkFile(path.join(repoDir, "lerna.json"));

    const pkg = yield* Effect.tryPromise({
      try: () => Bun.file(path.join(repoDir, "package.json")).json().then(PackageJsonSchema.parse),
      catch: (err) => new FrameworkDetectionError({ message: `Failed to parse package.json: ${err}` }),
    }).pipe(Effect.orDie);

    const hasWorkspaces = !!pkg.workspaces;
    const isMonorepo = hasTurborepo || hasNxJson || hasPnpmWs || hasLerna || hasWorkspaces;

    if (!isMonorepo) {
      return { isMonorepo: false, appDir: repoDir, tool: "none" } satisfies MonorepoInfo;
    }

    const candidates = [
      "apps/web", "apps/frontend", "apps/app", "apps/client",
      "apps/www", "apps/next", "apps/ui", "packages/app", "packages/web",
    ];

    for (const candidate of candidates) {
      const exists = yield* checkFile(path.join(repoDir, candidate, "package.json"));
      if (exists) {
        return {
          isMonorepo: true,
          appDir: candidate,
          tool: hasTurborepo ? "turbo" : hasNxJson ? "nx" : hasPnpmWs ? "pnpm" : "npm",
        } satisfies MonorepoInfo;
      }
    }

    // Fallback: scan apps/ and packages/
    for (const base of ["apps", "packages"]) {
      const basePath = path.join(repoDir, base);
      const entries = yield* Effect.try({
        try: () => readdirSync(basePath, { withFileTypes: true }),
        catch: () => new FrameworkDetectionError({ message: `Could not read directory: ${basePath}` }),
      }).pipe(Effect.catchAll(() => Effect.succeed([])));

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const hasPkg = yield* checkFile(path.join(basePath, entry.name, "package.json"));
          if (hasPkg) {
            return {
              isMonorepo: true,
              appDir: `${base}/${entry.name}`,
              tool: hasTurborepo ? "turbo" : hasNxJson ? "nx" : hasPnpmWs ? "pnpm" : "npm",
            } satisfies MonorepoInfo;
          }
        }
      }
    }

    return { isMonorepo: true, appDir: repoDir, tool: "none" } satisfies MonorepoInfo;
  });

// --- Framework Identification ---

export interface FrameworkInfo {
  framework: string;
  deps: Record<string, string>;
  scripts: Record<string, string>;
  pm: string;
  baseImage: string;
  pmSetup: string;
  pmInstall: string;
  runtime: string;
  hasBuild: boolean;
  hasStart: boolean;
}

export const detectFramework = (repoDir: string, monorepo: MonorepoInfo) =>
  Effect.gen(function* () {
    const pkgPath = monorepo.isMonorepo
      ? path.join(repoDir, monorepo.appDir, "package.json")
      : path.join(repoDir, "package.json");

    const pkg = yield* Effect.tryPromise({
      try: () => Bun.file(pkgPath).json().then(PackageJsonSchema.parse),
      catch: (err) => new FrameworkDetectionError({ message: `Failed to parse package.json: ${err}` }),
    }).pipe(Effect.orDie);

    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const scripts = pkg.scripts || {};

    const isNext = !!deps["next"];
    const isNuxt = !!deps["nuxt"];
    const isRemix = !!deps["@remix-run/node"] || !!deps["@remix-run/react"];
    const isSvelte = !!deps["@sveltejs/kit"];
    const isAstro = !!deps["astro"];
    const isVite = !!deps["vite"] || scripts.build?.includes("vite");
    const isHono = !!deps["hono"];
    const isExpress = !!deps["express"];
    const isFastify = !!deps["fastify"];
    const isNest = !!deps["@nestjs/core"];

    const framework = isNext ? "Next.js" : isAstro ? "Astro" : isNuxt ? "Nuxt" : isRemix ? "Remix"
      : isSvelte ? "SvelteKit" : isVite ? "Vite" : isHono ? "Hono" : isExpress ? "Express"
      : isFastify ? "Fastify" : isNest ? "NestJS" : "Node.js";

    const checkFile = (fp: string) =>
      Effect.tryPromise({
        try: () => Bun.file(fp).exists(),
        catch: () => new FrameworkDetectionError({ message: `File check failed: ${fp}` }),
      }).pipe(Effect.orDie);

    const hasBun = (yield* checkFile(path.join(repoDir, "bun.lock"))) ||
      (yield* checkFile(path.join(repoDir, "bun.lockb")));
    const hasPnpm = yield* checkFile(path.join(repoDir, "pnpm-lock.yaml"));
    const hasYarn = yield* checkFile(path.join(repoDir, "yarn.lock"));

    const pm = hasBun ? "bun" : hasPnpm ? "pnpm" : hasYarn ? "yarn" : "npm";
    const baseImage = hasBun ? "oven/bun:alpine" : "node:22-alpine";
    const pmSetup = hasPnpm ? "RUN npm install -g pnpm" : hasYarn ? "RUN npm install -g yarn" : "";
    const pmInstall = pm === "bun" ? "bun install --frozen-lockfile"
      : hasPnpm ? "pnpm install --frozen-lockfile"
      : hasYarn ? "yarn install --frozen-lockfile"
      : "npm ci";
    const runtime = hasBun ? "bun" : "node";

    return {
      framework, deps, scripts, pm, baseImage, pmSetup, pmInstall, runtime,
      hasBuild: !!scripts.build,
      hasStart: !!scripts.start,
    } satisfies FrameworkInfo;
  });
