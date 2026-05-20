import { pgTable, uuid, text, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const deploymentStatusEnum = pgEnum("deployment_status", [
  "pending",
  "building",
  "running",
  "stopped",
  "failed",
]);

export const repoTypeEnum = pgEnum("repo_type", [
  "frontend",
  "backend",
  "monorepo",
]);

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectRepositories = pgTable("project_repositories", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .references(() => projects.id)
    .notNull(),
  repoFullName: text("repo_full_name").notNull().unique(), // e.g. "org/repo"
  repoType: repoTypeEnum("repo_type").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const deployments = pgTable("deployments", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .references(() => projects.id)
    .notNull(),
  repositoryId: uuid("repository_id")
    .references(() => projectRepositories.id)
    .notNull(),
  branch: text("branch").notNull(),
  commitSha: text("commit_sha").notNull(),
  commitMessage: text("commit_message"),
  framework: text("framework"), // e.g. "nextjs", "vite", etc.
  logs: text("logs"), // Persistent build logs
  status: deploymentStatusEnum("status").default("pending").notNull(),
  previewUrl: text("preview_url"),
  discordMessageId: text("discord_message_id"),
  discordChannelId: text("discord_channel_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
});

export const projectEnvs = pgTable("project_envs", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .references(() => projects.id)
    .notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(), // Should be encrypted in a real app
  branch: text("branch"), // Optional: null means all branches (project-wide)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
