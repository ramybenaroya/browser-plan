// Dev launcher: render the browser-plan browser UI with data from a config file,
// without standing up a full MCP client. Reuses the exact same callback server
// and schema the `ask_user` tool uses, so what you see here matches production.
//
//   npm run open-app projects/ask-user-app/examples/medium.json
//   npm run open-app projects/ask-user-app/examples/heavy.mjs
//
// Config files are an `AskUserInput` ({ title, intro?, questions }) as either:
//   - JSON         (.json)            — parsed directly
//   - an ES module (.mjs / .ts / .js) — default export (nicer for multi-line
//                                        Markdown intros with Mermaid)
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureCallbackServer } from "../projects/ask-user-app/src/callback-server";
import { openBrowser } from "../projects/ask-user-app/src/open-browser";
import { askUserInputSchema } from "../projects/ask-user-app/src/questions";

const EXAMPLES = [
  "projects/ask-user-app/examples/light.json",
  "projects/ask-user-app/examples/medium.json",
  "projects/ask-user-app/examples/heavy.mjs",
];

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Load a config by extension: JSON is parsed, everything else is imported. */
async function loadConfig(path: string): Promise<unknown> {
  const abs = resolve(path);
  if (extname(abs) === ".json") {
    return JSON.parse(await readFile(abs, "utf8"));
  }
  const mod = await import(pathToFileURL(abs).href);
  return mod.default ?? mod;
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    die(
      `Usage: npm run open-app <config>\n\n` +
        `  <config> is a .json or .mjs/.ts file exporting { title, intro?, questions }.\n\n` +
        `Examples:\n` +
        EXAMPLES.map((e) => `  npm run open-app ${e}`).join("\n"),
    );
  }

  let raw: unknown;
  try {
    raw = await loadConfig(path);
  } catch (err) {
    die(`Could not load "${path}": ${err instanceof Error ? err.message : String(err)}`);
  }

  const parsed = askUserInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    die(`Invalid config "${path}":\n${issues}`);
  }

  const { baseUrl, specs } = await ensureCallbackServer();
  const sid = randomUUID();
  specs.set(sid, parsed.data);

  const url = `${baseUrl}/ask?sid=${sid}`;
  console.log(`\n  browser-plan UI for "${path}"\n  ${url}\n\n  Press Ctrl+C to stop.\n`);
  openBrowser(url);
}

main().catch((err) => {
  die(`open-app failed: ${err instanceof Error ? err.message : String(err)}`);
});
