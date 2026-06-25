import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  serverExternalPackages: ["better-sqlite3", "ssh2"],
  images: { unoptimized: true },
};

export default nextConfig;
