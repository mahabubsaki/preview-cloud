// import { Octokit } from "octokit";
// import * as dotenv from "dotenv";
// import * as path from "path";

// // Manually load .env from root
// dotenv.config({ path: path.join(process.cwd(), "../../.env") });

// const octokit = new Octokit({
//   auth: process.env.GITHUB_TOKEN,
// });

// const owner = "mahabubsaki";
// const repo = "preview-cloud-ph";

// console.log(`📡 Testing dispatch for ${owner}/${repo}...`);
// console.log(`🔑 Token check: ${process.env.GITHUB_TOKEN ? "Found (starts with " + process.env.GITHUB_TOKEN.substring(0, 10) + ")" : "NOT FOUND"}`);

// try {
//   const response = await octokit.request("POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches", {
//     owner,
//     repo,
//     workflow_id: "builder.yml",
//     ref: "main",
//     headers: {
//       "X-GitHub-Api-Version": "2022-11-28",
//     },
//     inputs: {
//       repo_url: "https://github.com/mahabubsaki/lmao",
//       commit_sha: "test-sha",
//       image_tag: "test-tag",
//       build_args: "{}",
//       callback_url: "http://localhost:3001/api/build-complete",
//       deployment_id: "test-dep-id",
//       framework: "Vite",
//     },
//   });

//   console.log("✅ Response Status:", response.status);
// } catch (error) {
//   console.error("❌ Error Status:", error.status);
//   console.error("❌ Error Message:", error.message);
//   if (error.response?.data) {
//     console.error("❌ Error Data:", JSON.stringify(error.response.data, null, 2));
//   }
// }
