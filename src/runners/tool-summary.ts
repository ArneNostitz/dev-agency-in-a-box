/**
 * The one-liner tool-call summary for the activity stream. Single source (issue #61 dedup) —
 * imported by roleAgent (SDK path), the pi SDK runner, and the registry re-exports it for back-compat.
 *
 * Kept in its own module so runners (sdk-pi, sdk-claude) can import it without forming a cycle with
 * the registry (which imports the runner classes).
 */
export function summarizeTool(name: string, input: Record<string, unknown> = {}): string {
  const s = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
  switch (name) {
    case "Bash":
    case "bash":
      return `$ ${s(input.command)}`;
    case "Write":
    case "write":
      return `✏️ write ${s(input.file_path || input.path)}`;
    case "Edit":
    case "edit":
      return `✏️ edit ${s(input.file_path || input.path)}`;
    case "Read":
    case "read":
      return `📖 read ${s(input.file_path || input.path)}`;
    case "Grep":
    case "grep":
      return `🔎 grep ${s(input.pattern)}`;
    case "Glob":
    case "glob":
    case "find":
      return `🔎 find ${s(input.pattern || input.path)}`;
    case "WebSearch":
      return `🌐 search ${s(input.query)}`;
    case "WebFetch":
      return `🌐 fetch ${s(input.url)}`;
    case "TodoWrite":
      return `📋 plan: ${(Array.isArray(input.todos) ? input.todos : []).map((t: unknown) => (t as { content?: string }).content || "").filter(Boolean).slice(0, 4).join(" · ").slice(0, 160) || "updated the todo list"}`;
    case "Task":
      return `🤝 subagent: ${s(input.description || input.prompt)}`;
    default: {
      // MCP tools — surface the server + tool + its key argument so GitNexus/recall calls are legible.
      const mcp = /^mcp__([^_]+)__(.+)$/.exec(name);
      if (mcp) {
        const [, server, tool] = mcp;
        const arg = s(input.symbol || input.query || input.name || input.q || input.path || input.cypher || Object.values(input)[0]);
        const icon = server === "gitnexus" ? "🧠" : server === "recall" ? "📚" : "🔌";
        return `${icon} ${server}.${tool}${arg ? `(${arg})` : ""}`;
      }
      return `🔧 ${name}${input.description ? `: ${s(input.description)}` : ""}`;
    }
  }
}
