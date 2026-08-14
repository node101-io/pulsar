import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Covers the pure modules only — the ones where a wrong answer is silent:
// amounts, and which pending deposit a chain credit belongs to. Component
// rendering is deliberately out of scope; it fails loudly in the browser.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
