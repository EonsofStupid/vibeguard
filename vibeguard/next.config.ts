import type { NextConfig } from "next";

const chatPort = process.env.VIBEGUARD_CHAT_PORT;
const isolatedChatPort = chatPort && /^\d+$/.test(chatPort)
  && Number(chatPort) > 0 && Number(chatPort) <= 65535;

const nextConfig: NextConfig = {
  // Separate ports and roles keep their development locks and build files apart.
  distDir: isolatedChatPort
    ? `.next-chat-${Number(chatPort)}`
    : process.env.VIBEGUARD_DASHBOARD_ROLE === "review"
      ? ".next-review"
      : process.env.VIBEGUARD_DASHBOARD_ROLE === "chat"
        ? ".next-chat"
        : ".next",
};

export default nextConfig;
