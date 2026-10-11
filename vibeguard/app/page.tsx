import { Chat } from "@/components/chat/chat";

export default function Home() {
  return <Chat mode={process.env.VIBEGUARD_CHAT_BACKEND === "model" ? "model" : "agentengine"} />;
}
