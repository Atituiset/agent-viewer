import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["electron/**/*.test.ts", "src/**/*.test.{ts,tsx}"],
    // 用 jsdom 的测试在文件头标 `// @vitest-environment jsdom`（vitest 4 移除了 environmentMatchGlobs）。
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: { "@": "/src" },
  },
});
