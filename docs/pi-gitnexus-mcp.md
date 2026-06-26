# GitNexus on the pi runner (GLM/Gemini) — findings + plan

## Problem
When a non-Claude provider (GLM/Zhipu, Gemini-proxy) runs via the **pi** runner, the agent has NO
GitNexus tools, so it falls back to raw `fd`/`glob`/`grep` to find code (token-expensive, weak).

## Why
`RunRequest.mcpServers`/`allowedTools` are wired ONLY into the SDK runner (`sdk-claude.ts`). The pi
runner (`sdk-pi.ts`) invokes `pi --mode json --print …` and never passes MCP config — by design the
comment says "CLI runners pick their own tools."

## What pi actually supports (verified at pi.dev/packages?name=mcp)
pi DOES support MCP, but through **installed extensions**, not a one-shot flag:
- `pi install npm:pi-mcp-adapter` (or `@0xkobold/pi-mcp`, `@pi-unipi/mcp`, …) bridges arbitrary MCP
  servers (stdio/SSE/HTTP) into pi's tool set.
- The MCP servers are then registered in pi's config (per-project/global), not passed per-invocation.

## Plan (deploy-dependent — needs the image + a live test)
1. Bake a pi MCP-adapter extension into the Docker image (`pi install npm:pi-mcp-adapter`).
2. When the pi runner starts and `req.mcpServers` is non-empty, write a pi MCP config (the adapter's
   expected format) into the run's config dir registering each server (gitnexus stdio: `gitnexus mcp`).
3. Add the GitNexus prompt note for pi runs too (so the agent knows to prefer the graph tools).
4. Verify on a live GLM run that `mcp__gitnexus__context` etc. are callable.

## Interim (works today, no pi changes)
The built-in **SDK runner drives ANY Anthropic-compatible provider directly (incl. GLM/Zhipu)** AND
wires GitNexus MCP. For GitNexus on GLM **right now**, set the provider's runner to `claude-sdk` in
Settings → Models (GLM still routes to its own baseUrl+key; it just uses the SDK loop, which carries
the MCP servers). pi remains available for providers/workflows that prefer it once step 1–4 land.
