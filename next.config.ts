import type { NextConfig } from "next";
import { securityHeaders } from "./src/server/security-headers";

const production = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders({ production }) }];
  },
};

export default nextConfig;
