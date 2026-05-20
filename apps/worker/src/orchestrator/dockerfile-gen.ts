import { Effect } from "effect";
import type { MonorepoInfo, FrameworkInfo } from "./framework";

// --- Dockerfile Generation ---

export const generateDockerfileContent = (
  monorepo: MonorepoInfo,
  fw: FrameworkInfo
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const { isMonorepo, appDir, tool } = monorepo;
    const { framework, pm, baseImage, pmSetup, pmInstall, runtime, hasBuild, hasStart } = fw;

    const buildCmd = tool === "turbo"
      ? `pnpm turbo run build --filter=./${appDir}`
      : tool === "nx"
      ? `npx nx build`
      : `${pm} run build`;

    let dockerfile = "";

    switch (framework) {
      case "Next.js":
        if (isMonorepo) {
          dockerfile = `
FROM ${baseImage} AS builder
WORKDIR /app
${pmSetup}
COPY . .
RUN ${pmInstall}
RUN ${buildCmd}

FROM ${baseImage} AS runner
WORKDIR /app
${pmSetup}
COPY --from=builder /app/${appDir}/.next/standalone ./
COPY --from=builder /app/${appDir}/.next/static ./${appDir}/.next/static
COPY --from=builder /app/${appDir}/public ./${appDir}/public
EXPOSE 3000
ENV PORT=3000
CMD ["${runtime}", "${appDir}/server.js"]
          `.trim();
        } else {
          dockerfile = `
FROM ${baseImage}
WORKDIR /app
${pmSetup}
COPY package*.json ./
RUN ${pmInstall}
COPY . .
RUN ${pm} run build
EXPOSE 3000
ENV PORT=3000
CMD ["${pm}", "run", "start"]
          `.trim();
        }
        break;

      case "Vite":
      case "Astro":
      case "Nuxt":
      case "Remix":
      case "SvelteKit": {
        const buildDir = framework === "Astro" ? "dist" : "dist";
        const finalAppDir = isMonorepo ? `${appDir}/${buildDir}` : buildDir;

        dockerfile = `
FROM ${baseImage} AS builder
WORKDIR /app
${pmSetup}
COPY . .
RUN ${pmInstall}
${isMonorepo ? `RUN ${buildCmd}` : `RUN ${pm} run build`}

FROM ${baseImage}
${pm === "bun" ? "" : "RUN npm install -g serve"}
WORKDIR /app
COPY --from=builder /app/${finalAppDir} ./dist
EXPOSE 3000
CMD [${pm === "bun" ? '"bun", "x", "serve"' : '"serve"'}, "-s", "dist", "-l", "3000"]
        `.trim();
        break;
      }

      case "Hono":
      case "Express":
      case "Fastify":
      case "NestJS":
        dockerfile = `
FROM ${baseImage}
WORKDIR /app
${pmSetup}
COPY package*.json ./
RUN ${pmInstall}
COPY . .
${hasBuild ? `RUN ${pm} run build` : ""}
EXPOSE 3000
ENV PORT=3000
CMD [${hasStart ? `"${pm}", "run", ${isMonorepo ? `"--prefix", "${appDir}",` : ""} "start"` : `"${runtime}", "${isMonorepo ? `${appDir}/` : ""}index.js"`}]
        `.trim();
        break;

      default:
        dockerfile = `
FROM ${baseImage}
WORKDIR /app
${pmSetup}
COPY package*.json ./
RUN ${pmInstall}
COPY . .
${hasBuild ? `RUN ${pm} run build` : ""}
EXPOSE 3000
ENV PORT=3000
CMD [${hasStart ? `"${pm}", "run", ${isMonorepo ? `"--prefix", "${appDir}",` : ""} "start"` : `"${runtime}", "${isMonorepo ? `${appDir}/` : ""}index.js"`}]
        `.trim();
        break;
    }

    return dockerfile;
  });
