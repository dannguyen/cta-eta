import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      $lib: path.resolve(rootDir, "src/lib"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
  },
});
