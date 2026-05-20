import { $ } from "bun";

const webhookUrl = process.env.SMEE_URL;
const buildUrl = process.env.BUILD_SMEE_URL;
const logUrl = process.env.LOG_SMEE_URL;

if (!webhookUrl || !buildUrl || !logUrl) {
  console.error("❌ SMEE_URL, BUILD_SMEE_URL, or LOG_SMEE_URL is not defined in .env");
  process.exit(1);
}

console.log("📡 Starting consolidated Smee proxies...");
console.log(`🔗 Webhook: ${webhookUrl} -> http://127.0.0.1:3001/webhooks`);
console.log(`🏗️ Build:   ${buildUrl} -> http://127.0.0.1:3001/api/build-complete`);
console.log(`📜 Logs:    ${logUrl} -> http://127.0.0.1:3001/api/build-log`);

// Run all tunnels in parallel
await Promise.all([
  $`bunx smee-client --url ${webhookUrl} --target http://127.0.0.1:3001/webhooks`.nothrow(),
  $`bunx smee-client --url ${buildUrl} --target http://127.0.0.1:3001/api/build-complete`.nothrow(),
  $`bunx smee-client --url ${logUrl} --target http://127.0.0.1:3001/api/build-log`.nothrow()
]);
