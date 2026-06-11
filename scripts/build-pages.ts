// Build the static gh-pages showcase into ./dist, then publish with
// `npm run pages:deploy` (gh-pages -d dist).
//
// The showcase reuses the *exact* ask-user app — it copies projects/ask-user-app/
// public/ verbatim and embeds it in an iframe (see projects/gh-pages/index.html),
// so there is no second copy of the form code. The only build-time work is:
//   - copying the app's public assets,
//   - serializing each example spec to JSON (heavy.mjs is an ES module, so it
//     can't be fetched statically until it's turned into JSON),
//   - dropping in the landing page + a .nojekyll marker.
//
// Example specs are validated with the same `askUserInputSchema` the `ask_user`
// tool uses (matching scripts/open-app.ts), so what ships is what production renders.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { askUserInputSchema } from "../projects/ask-user-app/src/questions";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_PUBLIC = join(ROOT, "projects/ask-user-app/public");
const EXAMPLES_DIR = join(ROOT, "projects/ask-user-app/examples");
const LANDING_DIR = join(ROOT, "projects/gh-pages");
const DIST = join(ROOT, "dist");

// name -> source spec file. The browser fetches these as `examples/<name>.json`.
const EXAMPLES: Record<string, string> = {
  light: join(EXAMPLES_DIR, "light.json"),
  medium: join(EXAMPLES_DIR, "medium.json"),
  heavy: join(EXAMPLES_DIR, "heavy.mjs"),
};

/** Load a spec by extension: JSON is parsed, everything else is imported. */
async function loadConfig(path: string): Promise<unknown> {
  if (extname(path) === ".json") {
    return JSON.parse(await readFile(path, "utf8"));
  }
  const mod = await import(pathToFileURL(path).href);
  return mod.default ?? mod;
}

async function buildExamples(): Promise<void> {
  await mkdir(join(DIST, "examples"), { recursive: true });
  for (const [name, path] of Object.entries(EXAMPLES)) {
    const parsed = askUserInputSchema.safeParse(await loadConfig(path));
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
      throw new Error(`Invalid example "${name}" (${path}):\n${issues}`);
    }
    await writeFile(
      join(DIST, "examples", `${name}.json`),
      JSON.stringify(parsed.data, null, 2),
    );
    console.log(`  ✓ examples/${name}.json`);
  }
}

async function main(): Promise<void> {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  // The exact ask-user app, served at /ask-user/ and embedded via iframe.
  await cp(APP_PUBLIC, join(DIST, "ask-user"), { recursive: true });
  console.log("  ✓ ask-user/ (app copied verbatim)");

  await buildExamples();

  // Landing page + its styles.
  await cp(join(LANDING_DIR, "index.html"), join(DIST, "index.html"));
  await cp(join(LANDING_DIR, "landing.css"), join(DIST, "landing.css"));
  console.log("  ✓ index.html + landing.css");

  // Tell GitHub Pages to serve the files as-is (skip Jekyll processing).
  await writeFile(join(DIST, ".nojekyll"), "");
  console.log("  ✓ .nojekyll");

  console.log(`\nBuilt gh-pages showcase into ${DIST}\n`);
}

main().catch((err) => {
  console.error(`build-pages failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
