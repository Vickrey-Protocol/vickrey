import { execSync } from "node:child_process";

/* `<epoch-millis>.<sha7>`, inlined into the client bundle. Tabs compare it over a
   BroadcastChannel to tell which of them is running an older build. The timestamp
   prefix makes "older" a comparison rather than a guess.

   The timestamp is the *commit's*, not the build's. This file is evaluated more than
   once per build — the server and client compiles each read it — and `Date.now()` gave
   the two bundles ids nine seconds apart on Vercel. The commit time is the same in every
   evaluation and every rebuild of the same commit, and it still orders deploys. */
const git = (args) => { try { return execSync(`git ${args}`).toString().trim(); } catch { return ""; } };
const sha = process.env.VERCEL_GIT_COMMIT_SHA || git("rev-parse HEAD") || "unknown";
const committed = Number(git(`log -1 --format=%ct ${sha === "unknown" ? "HEAD" : sha}`)) * 1000;
const buildId = `${committed || Date.now()}.${sha.slice(0, 7)}`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  // The client library is consumed as TypeScript source from the sibling package.
  transpilePackages: ["@vickrey/client"],
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
};
export default nextConfig;
