import { Chat } from "@/components/chat/chat";

export default function Home() {
  const memoryMode = process.env.VIBEGUARD_MEMORY_MODE === "hosted" || process.env.VIBEGUARD_MEMORY_MODE === "local" ? process.env.VIBEGUARD_MEMORY_MODE : null;
  return <Chat mode={process.env.VIBEGUARD_CHAT_BACKEND === "model" ? "model" : "agentengine"} memoryMode={memoryMode} memoryUser={process.env.VIBEGUARD_MEMORY_USER_ID || "vibeguard-operator"} />;
}
