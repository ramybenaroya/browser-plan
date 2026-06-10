# Changelog

All notable changes to **browser-plan** are documented here. This project follows
[Semantic Versioning](https://semver.org) and the
[Keep a Changelog](https://keepachangelog.com) format.

## [0.1.0] — 2026-06-11

🎉 **First public release.**

browser-plan is a local **stdio MCP server** that hands an AI agent's planning
questions to a real **browser form** — text boxes, radio buttons, checkboxes,
sliders — instead of cramped terminal pickers or a wall of chat text. You see
every choice laid out, you can't misfire, and the whole planning arc is saved so
you can replay how a decision was reached.

### Added

- **Three MCP tools** built around a single session id:
  - `init_browser_plan_session` — mints a session id and creates the session on disk.
  - `ask_user` — opens the browser form, asks 1–20 questions, returns the answers.
  - `save_plan` — saves a plan (Markdown) as a new version; full history is kept.
- **Five question kinds:** `text`, `longtext`, `single` (radio), `multi`
  (checkbox), and `scale` (slider).
- **Tabbed forms with full keyboard navigation** — group questions into tabs,
  move with arrow keys, and submit only once every required field is answered.
- **Rich Markdown intros & per-option illustrations** — GitHub-flavored Markdown
  with syntax-highlighted code, Mermaid and ASCII diagrams (clickable lightbox),
  sanitized via DOMPurify, with graceful plain-text fallback when offline.
- **Works across every harness** — one stdio command for Claude Code, Claude
  Desktop, Cursor, VS Code (Copilot), OpenAI Codex, and any other MCP client.
- **Automatic browser-open** — URL-mode elicitation (MCP spec `2025-11-25`,
  SEP-1036) where the client supports it, direct local open otherwise (e.g. the
  Claude Code CLI).
- **Session persistence** — every question, answer, and plan version is written
  under `~/.browser-plan` (override with `BROWSER_PLAN_DATA_DIR`).
- **`browser-plan retro`** — a read-only retrospective viewer that replays any
  saved session's questions, answers, and plan history.
- **`/browser-plan` skill** — steers the harness to ask its questions through
  browser-plan instead of its default prompts.

### Security

- The callback server binds **`127.0.0.1` only** on an ephemeral port; answers
  are POSTed straight there and **never flow back through the agent**.
- No auth beyond an unguessable per-ask `sid`; session maps are in-memory only.
- The UI sets no cookies and stores nothing sensitive — only a theme preference
  in `localStorage`.
- stdout is reserved for the JSON-RPC stream; all logs go to stderr.
- ⚠️ **Non-sensitive input only** — never collect passwords, API keys, tokens, or
  payment data through the form.

### Requirements

- **Node.js 18+** and any MCP client.

[0.1.0]: https://github.com/ramybenaroya/browser-plan/releases/tag/v0.1.0
