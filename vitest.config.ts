import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "~": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
