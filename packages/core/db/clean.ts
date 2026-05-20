import { createDbClient, deployments, projectRepositories, projects, projectEnvs } from "./index";

const DATABASE_URL = process.env.DATABASE_URL || "postgres://preview_user:preview_pass_99@localhost:15432/github_app_deployments";

async function clean() {
  const { db } = createDbClient(DATABASE_URL);

  console.log("🧹 Starting Database Cleanup...");

  try {
    // We delete in reverse order of foreign keys
    console.log("🗑️ Deleting Deployments...");
    await db.delete(deployments);

    console.log("🗑️ Deleting Project Envs...");
    await db.delete(projectEnvs);

    console.log("🗑️ Deleting Project Repositories...");
    await db.delete(projectRepositories);

    console.log("🗑️ Deleting Projects...");
    await db.delete(projects);

    console.log("✨ Database is now clean!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Cleanup failed:", error);
    process.exit(1);
  }
}

clean();
