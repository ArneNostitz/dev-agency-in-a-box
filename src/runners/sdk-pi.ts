/**
 * PiSdkRunner — runs pi IN-PROCESS via the @earendil-works/pi-coding-agent SDK.
 *
 * This replaced the old subprocess PiCliRunner (spawn + NDJSON parsing + splitArgs + --no-approve
 * trust hacks) which hung silently on the deployment. The SDK gives us a typed event stream, native
 * auth, native model resolution, and native system-prompt injection — no shell, no argv, no trust
 * prompt. "Use the SDK as-is, do not modify pi."
 *
 * Architecture (#136):
 *   AuthStorage.create()            → reads ~/.pi/agent/auth.json (written at provider-save by setProviders)
 *   ModelRegistry.create(auth)      → pi's full model catalog; .find(piKey, modelId) resolves the Model
 *   DefaultResourceLoader({systemPrompt}) → carries OUR system prompt (createAgentSession has no systemPrompt option)
 *   SessionManager.inMemory(cwd)    → ephemeral; the agency has its own resume store (sessions table)
 *   createAgentSession({model, tools, ...}) → { session }
 *   session.subscribe(event → emitAssistant) → typed events: message_update/text_delta, tool_execution_*, turn_end, agent_end
 *   session.prompt(task)            → resolves when the run completes; session.abort() cancels
 *
 * The runner kind stays "pi-cli" for routing compatibility (runnerKindFor routes any provider with a
 * piKey here). runnerBinary("pi-cli") returns null (in-process, like claude-sdk) so no binary preflight.
 *
 * Sources: https://pi.dev/docs/latest/sdk · installed types at @earendil-works/pi-coding-agent v0.79.6
 */
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentRunner, RunRequest, RunResult } from "./interface.js";
import type { Provider } from "../db/providers.js";
import { inferPiProvider } from "../db/providers.js";
import { summarizeTool } from "./tool-summary.js";

/**
 * Resolve the pi provider key for a run. Primary source is the explicit `piKey` on the row; legacy
 * baseUrl/name inference is a fallback for old rows. Auth lives in pi's real ~/.pi/agent/auth.json
 * (written at save); the SDK reads it natively.
 */
export function preparePiConfig(provider: Provider | null): { piProvider: string } {
  if (!provider) return { piProvider: "" };
  return { piProvider: inferPiProvider(provider) };
}

/**
 * Map the agency's Claude-style tool names to pi's lowercase builtin tool names. Unknown names that
 * are already lowercase (extension/MCP tools) pass through. Tools with no pi equivalent (TodoWrite,
 * Task, WebSearch, WebFetch) are dropped — same as a Claude run without them.
 */
function mapToolsToPi(allowed: string[] | undefined): string[] | undefined {
  if (!allowed || allowed.length === 0) return undefined; // undefined = pi's default toolset
  const known: Record<string, string> = {
    Read: "read",
    Write: "write",
    Edit: "edit",
    Bash: "bash",
    Grep: "grep",
    Glob: "find",
  };
  const out = new Set<string>();
  for (const t of allowed) {
    if (known[t]) out.add(known[t]);
    else if (/^[a-z]/.test(t)) out.add(t); // extension/custom tool — pass through verbatim
    // else: a Claude-only tool (TodoWrite, Task, WebSearch…) with no pi equivalent → drop
  }
  return [...out];
}

/** Sum the billable usage fields (input + output + cache-write; exclude cache-read — see sdk-claude.ts). */
function billableTokens(u: { input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  return u.input + u.output + u.cacheWrite;
}

export class PiSdkRunner implements AgentRunner {
  readonly kind = "pi-cli";

  async run(req: RunRequest, emitAssistant: (message: unknown) => void): Promise<RunResult> {
    const piProvider = preparePiConfig(req.provider).piProvider;
    if (!piProvider) {
      throw new Error("This provider has no pi key — pick a provider from the list in Settings → Models.");
    }

    // 1. Auth + model registry. The agency's DB is the source of truth for API keys; auth.json is
    //    just a cache that may be absent (e.g. fresh container before any Settings save). Inject the
    //    provider's key directly as a runtime override so the run authenticates regardless of file
    //    state. (writePiAuthKey also persists it for the CLI / discovery, but that's best-effort.)
    const authStorage = AuthStorage.create();
    const apiKey = req.provider?.apiKey?.trim();
    if (apiKey) authStorage.setRuntimeApiKey(piProvider, apiKey);
    const modelRegistry = ModelRegistry.create(authStorage);
    const model = modelRegistry.find(piProvider, req.model);
    if (!model) {
      const available = modelRegistry.getAvailable().filter((m) => m.provider === piProvider).map((m) => m.id).slice(0, 10).join(", ");
      throw new Error(
        `pi doesn't know model "${req.model}" for provider "${piProvider}".` +
          (available ? ` Available: ${available}` : ` Run model discovery (Settings → Models → Refresh) for this provider.`),
      );
    }

    // 2. Resource loader carries OUR system prompt. createAgentSession has no systemPrompt option,
    //    so this is the official path. We disable pi's own context/extension/skill/theme discovery
    //    (noContextFiles/noExtensions/…) for deterministic autonomous runs — the agency provides the
      //    full system prompt and tool list. Trust prompts never fire because no extensions load.
      //    Re-enable extensions here when the agency grows a pi-extension story.
      //
      //    CRITICAL: reload() MUST be called after construction. DefaultResourceLoader stores the
      //    raw `systemPrompt` option in `systemPromptSource` but only resolves it into the usable
      //    `systemPrompt` field inside reload(). createAgentSession skips its own reload() when a
      //    loader is supplied (it assumes the caller already reloaded), so without this call pi runs
      //    with an EMPTY system prompt — the planner produces no plans, every role loses its persona.
      const resourceLoader = new DefaultResourceLoader({
        cwd: req.cwd,
        agentDir: getAgentDir(),
        systemPrompt: req.systemPrompt,
        noContextFiles: true,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
      });
      await resourceLoader.reload();

    // 3. PERSISTED session (data/pi-sessions) so a paused/interrupted run can actually resume.
    //    The agency's sessions table stores the session FILE PATH as the resume id for pi runs
    //    (Claude runs store the SDK's UUID — the two never collide: one is a path, one isn't).
    const sessionDir = join(process.env.PI_SESSION_DIR?.trim() || join(process.cwd(), "data", "pi-sessions"));
    try { mkdirSync(sessionDir, { recursive: true }); } catch { /* best effort */ }
    let sessionManager: SessionManager;
    if (req.resumeId && req.resumeId.includes("/") && existsSync(req.resumeId)) {
      sessionManager = SessionManager.open(req.resumeId, dirname(req.resumeId), req.cwd);
    } else {
      sessionManager = SessionManager.create(req.cwd, sessionDir);
    }

    // 4. Build the tools list from the agency's allowedTools (mapped to pi names).
    const tools = mapToolsToPi(req.allowedTools);

    const { session } = await createAgentSession({
      cwd: req.cwd,
      model,
      tools,
      resourceLoader,
      sessionManager,
      authStorage,
      modelRegistry,
    });

    // Running totals updated by the event listener.
    let text = "";
    let turns = 0;
    let tokens = 0;
    let costUsd = 0;
    let lastError = "";
    // Resume id = the persisted session file (falls back to pi's in-memory id if not persisted).
    const sessionId = sessionManager.getSessionFile() || session.sessionId;

    // 5. Subscribe to the typed event stream → translate to the agency's emitAssistant contract
    //    (the same shapes roleAgent/chat/orchestrator/analyzer already handle for the Claude SDK).
    //    pi's events are the same normalized AssistantMessageEvent union that streamSimple uses:
    //    text_delta, thinking_delta, toolcall_*, done, error.
    const seenTools = new Set<string>(); // dedupe toolcall_end + tool_execution_start (both fire)
    const unsubscribe = session.subscribe((event) => {
      switch (event.type) {
        case "message_update": {
          const ae = event.assistantMessageEvent;
          if (ae.type === "text_delta" && ae.delta) {
            // Live "typing" feed — same shape as Claude SDK's stream_delta (not persisted; final wins).
            emitAssistant({ type: "stream_delta", delta: ae.delta });
          } else if (ae.type === "thinking_delta" && ae.delta) {
            // Reasoning/thinking stream — surface as a distinct delta so the UI can show it inline.
            emitAssistant({ type: "stream_delta", delta: ae.delta });
          } else if (ae.type === "toolcall_end" && ae.toolCall) {
            // The model emitted a tool call. tool_execution_start fires separately with the same
            // id — emit only once (prefer the execution event which has the resolved args).
            const id = ae.toolCall.id || ae.toolCall.name;
            if (id) seenTools.add(id);
          }
          break;
        }
        case "tool_execution_start": {
          // Tool is about to run — surface a readable one-liner to the activity feed.
          const id = (event as { toolCallId?: string }).toolCallId || event.toolName;
          if (id && seenTools.has(id)) break; // already emitted via toolcall_end
          const summary = summarizeTool(event.toolName, (event.args ?? {}) as Record<string, unknown>);
          if (summary) emitAssistant({ type: "tool", summary });
          break;
        }
        case "message_end": {
          // The assistant message for this turn is final. Persist it + pull usage.
          const msg = event.message as {
            role?: string;
            content?: Array<{ type?: string; text?: string }>;
            usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost?: { total: number } };
            stopReason?: string;
            errorMessage?: string;
          };
          if (msg?.role === "assistant") {
            const txt = (msg.content ?? []).filter((c) => c.type === "text").map((c) => c.text || "").join("").trim();
            if (txt) {
              text = txt; // last assistant text wins (matches Claude SDK's `result` behavior)
              emitAssistant({ type: "assistant", message: { content: [{ type: "text", text: txt }] } });
            }
            if (msg.usage) {
              tokens += billableTokens(msg.usage);
              if (typeof msg.usage.cost?.total === "number") costUsd += msg.usage.cost.total;
            }
            if (msg.stopReason === "error" && msg.errorMessage) lastError = msg.errorMessage;
          }
          break;
        }
        case "turn_end": {
          turns += 1;
          break;
        }
        default:
          break;
      }
    });

    // 6. Wire the agency's abort signal to pi's session.abort().
    const onAbort = (): void => {
      void session.abort();
    };
    if (req.abort.signal.aborted) onAbort();
    else req.abort.signal.addEventListener("abort", onAbort, { once: true });

    // 7. Await completion. session.prompt() resolves when the agent finishes all turns; it throws on
    //    hard errors (auth failure, unreachable endpoint) — those bubble up to roleAgent's retry/
    //    fallback/rate-limit handling, same as the Claude SDK runner.
    let stopped = "";
    try {
      await session.prompt(req.task);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (req.abort.signal.aborted) {
        stopped = "aborted by user";
      } else {
        // Hard failure (401, network, rate-limit). Surface the real message so roleAgent's
        // parseRateLimit / fallback logic can react. Keep partial text + usage if any.
        unsubscribe();
        req.abort.signal.removeEventListener("abort", onAbort);
        try { session.dispose(); } catch { /* noop */ }
        throw new Error(lastError ? `${lastError} | ${msg}` : msg);
      }
    } finally {
      unsubscribe();
      req.abort.signal.removeEventListener("abort", onAbort);
      try { session.dispose(); } catch { /* noop */ }
    }

    // pi can finish "successfully" while every turn actually errored (the LLM failed but the
    // session loop exited cleanly). If we saw an error and got NO text, that's a failed run —
    // throw so rate-limit parking / fallback / needs-attention react, instead of the workflow
    // advancing on a phantom success (the "runs only the first agent" bug).
    if (!stopped && lastError && !text) {
      throw new Error(lastError);
    }
    // No text + no error = a real tool-only completion. Return the empty text honestly — callers
    // skip posting empty comments (no more "pi run completed." noise in the timeline).
    return {
      text,
      turns: Math.max(1, turns),
      tokens,
      costUsd,
      stopped,
      sessionId: sessionId || undefined,
    };
  }
}
