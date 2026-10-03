import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Mirrors the `@/*` alias from tsconfig so tests import the same paths the app does. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    /* Two contracts, as the site runs once v2 is live: v2 is acted on, v1 is read-only. */
    env: {
      NEXT_PUBLIC_AUCTION_ADDRESS: "0xa2",
      NEXT_PUBLIC_AUCTION_ADDRESS_V1: "0xa1",
    },
    // `*.live.test.ts` reads the real chain and runs on demand, never in the suite.
    // A unit test that needs a network is not a unit test, and one that fails because
    // Sepolia is slow teaches people to ignore a red mark.
    //
    //   npx vitest run --config vitest.config.ts --include "**<slash>*.live.test.ts"
    //
    // (line comments here on purpose: a glob containing a star-slash closes a block
    //  comment early, which is how this file stopped parsing once already.)
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/*.live.test.ts",
    ],
  },
});
