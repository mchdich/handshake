import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@paypal/agent-toolkit"],
  output: "standalone",
  // Demo deliverables (public/demo/<site>/index.html) are reviewed at /demo/<site>.
  async rewrites() {
    return [{ source: "/demo/:site", destination: "/demo/:site/index.html" }];
  },
};

export default nextConfig;
