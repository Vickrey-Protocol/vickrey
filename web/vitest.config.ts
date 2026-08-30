import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Mirrors the `@/*` alias from tsconfig so tests import the same paths the app does. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
});
