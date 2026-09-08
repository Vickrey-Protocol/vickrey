import { execSync } from "node:child_process";

/* `<epoch-millis>.<sha7>`, inlined into the client bundle. Tabs compare it over a
   BroadcastChannel to tell which of them is running an older build. The timestamp
   prefix makes "older" a comparison rather than a guess. */
const sha = process.env.VERCEL_GIT_COMMIT_SHA
  ?? (() => { try { return execSync("git rev-parse HEAD").toString().trim(); } catch { return "unknown"; } })();
const buildId = `${Date.now()}.${sha.slice(0, 7)}`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  // The client library is consumed as TypeScript source from the sibling package.
  transpilePackages: ["@vickrey/client"],
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
};
export default nextConfig;
