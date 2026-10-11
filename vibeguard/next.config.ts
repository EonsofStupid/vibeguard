import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Each role has its own dev lock and generated files when both clients run.
  distDir: process.env.VIBEGUARD_DASHBOARD_ROLE === "review"
    ? ".next-review"
    : process.env.VIBEGUARD_DASHBOARD_ROLE === "chat"
      ? ".next-chat"
      : ".next",
};

export default nextConfig;
