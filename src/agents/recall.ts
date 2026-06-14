/**
 * `recall` — the agency's own memory as an on-demand tool (Phase 1 of the v2 plan).
 *
 * An in-process MCP server (no subprocess) that lets a running agent PULL relevant prior work —
 * past plans, lessons learned, code-review notes, similar issues — when it's stuck or lacking
 * context, instead of us force-feeding the whole thread up front or the agent re-reading files.
 * Code-structure questions go to GitNexus; project-history questions go here.
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { searchMemory } from "../store.js";

export interface RecallWiring {
  servers: Record<string, ReturnType<typeof createSdkMcpServer>>;
  tools: string[];
}

/** Build the in-process `recall` MCP server scoped to a repo (prefers that repo's memory). */
export function recallWiring(repo: string): RecallWiring {
  const server = createSdkMcpServer({
    name: "recall",
    version: "1.0.0",
    tools: [
      tool(
        "recall",
        "Search the agency's OWN memory — past plans, lessons learned, prior code reviews, and similar issues — for how something was done or decided before. Use it when you lack context, hit something unfamiliar, or are about to re-read a lot of files: it's far cheaper. (For code structure — callers/impact of a symbol — use the GitNexus tools instead.)",
        { query: z.string().describe("what you're looking for, e.g. 'rate limit handling' or 'how are auth tokens resolved'") },
        async ({ query }) => {
          const hits = searchMemory(query, { repo, limit: 8 });
          if (!hits.length) {
            return { content: [{ type: "text" as const, text: "No prior memory matched — nothing recorded for this yet. Proceed; your work will be remembered for next time." }] };
          }
          const text = hits
            .map((h) => `• [${h.kind} ${h.repo.split("/").pop()}#${h.number}]\n${h.text}`)
            .join("\n\n");
          return { content: [{ type: "text" as const, text }] };
        },
      ),
    ],
  });
  return { servers: { recall: server }, tools: ["mcp__recall__recall"] };
}

/** Prompt note telling the agent the recall tool exists and when to reach for it. */
export const RECALL_PROMPT = [
  "=== AGENCY MEMORY (recall MCP available) ===",
  "You can search the agency's own past work with mcp__recall__recall (pass a short query). It returns",
  "relevant prior plans, lessons learned, code-review notes, and similar issues. Reach for it when you",
  "are unsure how something was done before or are about to read many files — it's cheaper than both.",
].join("\n");
