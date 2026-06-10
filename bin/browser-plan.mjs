#!/usr/bin/env node
// Single entry point for `npx browser-plan` (and global installs / `npm link`).
//   browser-plan [mcp]   -> MCP stdio server (in-process; stdin/stdout stay ours)
//   browser-plan retro   -> plans-retro Express SSR viewer (PORT overrides 4317)
//
// Both targets are written in TypeScript and run through tsx with no compile
// step, loaded in-process via tsx's programmatic loader. Each server starts on
// import (main()/app.listen() at the top level).
import { tsImport } from "tsx/esm/api";

const sub = process.argv[2] ?? "mcp";
const targets = {
  mcp: "../projects/mcp/server.ts",
  retro: "../projects/plans-retro/src/server.ts",
};

const target = targets[sub];
if (!target) {
  console.error(`[browser-plan] unknown command: ${sub}\nusage: browser-plan <mcp|retro>`);
  process.exit(1);
}

try {
  await tsImport(target, import.meta.url);
} catch (err) {
  // stderr only — for mcp, stdout is reserved for the JSON-RPC protocol stream.
  console.error(`[browser-plan] failed to start (${sub}):`, err);
  process.exit(1);
}
