import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["electron/**/*.test.ts", "src/lib/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": "/src" },
  },
});
