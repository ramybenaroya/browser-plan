<p align="center">
  <img src="logo-readme.png" width="96" height="96" alt="browser-plan logo" />
</p>

<h1 align="center">browser-plan</h1>

<p align="center">
  Plan with your coding agent through a real browser form — not a cramped terminal picker.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg" alt="Node >= 18" />
  <img src="https://img.shields.io/badge/MCP-stdio-7c5cff.svg" alt="MCP stdio server" />
</p>

## Why

Planning a feature with an AI agent means a stream of decisions: pick a language,
choose an approach, confirm a scope.

Modern harnesses ask these better than they used to — some pop a tidy
multiple-choice picker instead of "reply 1, 2, or 3…". But it's still bound to the
chat: one question at a time, terminal-width, and answered prompts scroll away.

A form does what a chat can't: it lays **all** the questions out at once, in a
layout built for choosing — radios, checkboxes, sliders, real text areas — so you
see the whole decision, can revise an earlier answer before submitting, and never
lose track of what you've decided. And handed a real page to render, the model
shines — framing a decision with proper **Mermaid diagrams**, not ASCII art
crammed into a code block.

## How

**browser-plan** hands those questions to a real **browser form** — text boxes,
radio buttons, checkboxes, sliders. Every choice laid out, no way to misfire, and
you answer at the pace of a form rather than a chat prompt.

It's an **MCP server**, so the *same* planning surface works across every harness —
Claude Code, Cursor, Claude Desktop, Codex, and more.

And it **persists the whole planning arc** — every question, every answer, every
version of the plan — so you can replay how a decision was reached later.

> ⚠️ **Non-sensitive input only.** This UI is for preferences, creative answers,
> and choices. Never use it to collect passwords, API keys, tokens, or payment data.

## Usage

```bash
npx browser-plan
```

### Add it to your harness

<details>
<summary><b>Claude Code</b></summary>

One command:

```bash
claude mcp add browser-plan -- npx -y browser-plan
```

Or as JSON in `.mcp.json` (project, committed) or `~/.claude.json` (user scope):

```json
{
  "mcpServers": {
    "browser-plan": { "command": "npx", "args": ["-y", "browser-plan"] }
  }
}
```

</details>

<details>
<summary><b>Claude Desktop</b></summary>

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) /
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "browser-plan": { "command": "npx", "args": ["-y", "browser-plan"] }
  }
}
```

</details>

<details>
<summary><b>Cursor</b></summary>

`.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "browser-plan": { "command": "npx", "args": ["-y", "browser-plan"] }
  }
}
```

</details>

<details>
<summary><b>VS Code (GitHub Copilot)</b></summary>

`.vscode/mcp.json` — note the key is `servers` (not `mcpServers`) and the
`"type": "stdio"`:

```json
{
  "servers": {
    "browser-plan": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "browser-plan"]
    }
  }
}
```

</details>

<details>
<summary><b>OpenAI Codex</b></summary>

`~/.codex/config.toml` — TOML, with a `[mcp_servers.<name>]` section:

```toml
[mcp_servers.browser-plan]
command = "npx"
args = ["-y", "browser-plan"]
```

</details>

## The Retro Viewer

A read-only viewer that browses everything browser-plan
has saved — per session, the questions asked, the answers given, and every plan
version:

```bash
npx browser-plan retro
```

It serves on `http://127.0.0.1:4317` (override with the `PORT` env var) and only
ever **reads** your data — it never opens the form or changes a session.

## `/browser-plan` skill

> The MCP server still has to be installed (see above) — the skill doesn't ship
> it. It just steers the harness to ask its questions through browser-plan
> instead of its default prompts.

#### Installation via skills.sh
```bash
npx skills add ramybenaroya/browser-plan
```
#### Usage
```bash
/browser-plan refactor codebase from zig to rust
```

## Tools

Under the hood the server exposes three tools. A **session id** threads a
questioning-and-planning arc together: mint it once, then pass it to every ask
and save.

| Tool | What it does |
|------|--------------|
| `init_browser_plan_session` | Mints a session id and creates the session on disk. Call once at the start. No browser. |
| `ask_user` | Opens the browser form, asks one or more questions, returns the answers. Persists them under the session. |
| `save_plan` | Saves the plan (Markdown) as a new version under the session — history is kept. No browser. |

**Flow:** call `init_browser_plan_session` once → pass its `sessionId` to every
`ask_user` round and every `save_plan`. Each `save_plan` writes a new version, so
the plan's full evolution is preserved.

> Full input schemas, the question kinds (`text`, `longtext`, `single`, `multi`,
> `scale`), Markdown/diagram support, storage layout, and architecture are in
> **[ARCHITECTURE.md](ARCHITECTURE.md)**.

## Requirements & security

- **Node.js 18+**, and any MCP client.
- The callback server binds **`127.0.0.1` only**, on an ephemeral port; answers
  are POSTed only there, never through the agent.
- The UI sets no cookies and stores nothing sensitive — only a theme preference
  in `localStorage`.
- Don't collect secrets (see the warning above).

More detail in [ARCHITECTURE.md](ARCHITECTURE.md).

## License

Released under the [MIT License](LICENSE) — © 2026 Ramy Ben Aroya.
