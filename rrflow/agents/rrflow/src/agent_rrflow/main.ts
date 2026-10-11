/** RRFlow: a deterministic human-review boundary for VibeGuard harness changes. */
import "dotenv/config";
import { App } from "@mongodb-js/agent-engine-sdk-langgraph";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph, interrupt, messagesStateReducer } from "@langchain/langgraph";
import { z } from "zod";
import { HarnessReviewStore, parseReviewRequest, parseReviewDecision, reviewPayload, type ReviewSnapshot, type ReviewDecision } from "./harnessReview.js";

export const app = new App({ appName: "rrflow" });
let store: HarnessReviewStore | undefined;
function reviewStore(): HarnessReviewStore { return store ??= new HarnessReviewStore(); }

// This runs in the agent process holding the durable checkpoint. No LLM can
// choose, fabricate or bypass the human decision.
const humanReview = app.tool({
  description: "Pause this exact harness proposal until a human approves or denies it.",
  schema: z.object({ snapshot: z.record(z.string(), z.unknown()) }),
})(function human_review({ snapshot }: { snapshot: ReviewSnapshot }): ReviewDecision {
  return parseReviewDecision(interrupt(reviewPayload(snapshot)));
});

const ReviewState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  snapshot: Annotation<ReviewSnapshot>(),
  decision: Annotation<ReviewDecision>(),
});

export const buildAgent = app.entrypoint(() => {
  const graph = new StateGraph(ReviewState)
    .addNode("load_proposal", async (state) => {
      const last = [...state.messages].reverse().find((message) => message.getType() === "human");
      if (!last || typeof last.content !== "string") throw new Error("Send a JSON message with proposal_id, version and policy_hash.");
      return { snapshot: await reviewStore().load(parseReviewRequest(last.content)) };
    })
    .addNode("human_review", (state) => ({ decision: humanReview({ snapshot: state.snapshot }) }))
    .addNode("commit_decision", async (state) => {
      const receipt = await reviewStore().decide(state.snapshot, state.decision, {
        service_user_id: app.getCurrentUserId() ?? undefined,
        session_id: app.getCurrentSessionId() ?? undefined,
      });
      return { messages: [new AIMessage(JSON.stringify({
        service: "rrflow", proposal_id: state.snapshot.proposal._id,
        decision: receipt.status, receipt_id: receipt._id,
        policy_hash: receipt.policy_hash, active_policy_version: receipt.active_policy_version,
        message: receipt.status === "approved"
          ? "Human approval and the active harness policy committed together in Atlas."
          : "The human rejected this proposal. No active policy changed.",
      }))] };
    })
    .addEdge(START, "load_proposal").addEdge("load_proposal", "human_review")
    .addEdge("human_review", "commit_decision").addEdge("commit_decision", END);
  const checkpointer = app.checkpointer();
  if (!checkpointer) throw new Error("RRFlow requires the durable Agent Engine checkpointer.");
  return graph.compile({ checkpointer: checkpointer as never }) as unknown;
});

export async function main(): Promise<void> { await app.run(); }
if (process.argv[1]?.endsWith("main.ts") || process.argv[1]?.endsWith("main.js")) {
  main().catch(() => {
    console.error("RRFlow could not start. Check Atlas connectivity and Agent Engine runtime logs.");
    process.exitCode = 1;
  });
}
