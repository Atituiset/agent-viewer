import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  assetPrefix: "./", // 相对路径，让 Electron 的 file:// 能加载到 _next 资源
  serverExternalPackages: ["better-sqlite3", "ssh2"],
  images: { unoptimized: true },
};

export default nextConfig;
