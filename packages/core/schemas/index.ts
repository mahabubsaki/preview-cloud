import { z } from "zod";

export const PackageJsonSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  workspaces: z.union([
    z.array(z.string()),
    z.object({
      packages: z.array(z.string())
    })
  ]).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  scripts: z.record(z.string(), z.string()).optional(),
}).loose();

export type PackageJson = z.infer<typeof PackageJsonSchema>;

export const EnvVarSchema = z.object({
  key: z.string(),
  value: z.string(),
});

export type EnvVar = z.infer<typeof EnvVarSchema>;

export const EnvVarListSchema = z.array(EnvVarSchema);
