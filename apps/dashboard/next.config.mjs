/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@github-app/core"],
  serverExternalPackages: ["ioredis", "bullmq", "pg", "drizzle-orm"],
};

export default nextConfig;
