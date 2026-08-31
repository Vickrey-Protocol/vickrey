import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The on-demand config for observations that read the real chain.
 *
 * A separate file rather than a CLI flag: `--include` is not a vitest option here, and a
 * run this consequential should not depend on remembering a glob. Invoked by
 * `npm run observe --workspace @vickrey/web`.
 */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: { include: ["lib/*.live.test.ts"], testTimeout: 60_000 },
});
