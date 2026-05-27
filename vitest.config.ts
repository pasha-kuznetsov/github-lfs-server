import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.spec.ts"],
          environment: "node",
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./test/wrangler.jsonc" },
            miniflare: {
              workers: [
                {
                  name: "admin-mock",
                  modules: true,
                  scriptPath: "./test/admin/admin-mock.js",
                },
              ],
            },
          }),
        ],
        test: {
          name: "integration",
          include: ["test/**/*.test.ts"],
          exclude: ["test/sentry/**"],
          // vitest-pool-workers cold-starts can exceed 5s on the first fetches.
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./test/sentry/wrangler.jsonc" },
          }),
        ],
        test: {
          name: "integration-sentry",
          include: ["test/sentry/**/*.test.ts"],
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
      {
        test: {
          name: "scripts",
          include: ["scripts/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
    coverage: {
      provider: "istanbul", // v8 isn't supported by vitest-pool-workers
      reporter: ["text", "text-summary", "json", "json-summary", "lcov"],
      exclude: ["test"],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 90,
        lines: 95,
      },
    },
  },
});
