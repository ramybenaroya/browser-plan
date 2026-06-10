// End-to-end smoke test for the browser-plan MCP server.
//
//   npx tsx scripts/browser-plan-smoke.ts
//
// Drives the REAL stdio server (bin/browser-plan.mjs) through the MCP SDK client over
// stdio — no test framework. It exercises the full session arc against a throwaway
// data dir ($BROWSER_PLAN_DATA_DIR -> a fresh mkdtemp):
//
//   init_browser_plan_session  -> mint + create a session on disk
//   save_plan x2         -> two plan versions, history kept
//   ask_user (answered)  -> submit out-of-band via POST /submit, get answers back
//   ask_user (timeout)   -> no submission -> times out (uses a short 5s timeout)
//   negatives            -> unknown session + non-UUID session id
//
// The client advertises NO elicitation capability, so the server takes the
// "open browser directly" path and (with ASK_NO_OPEN=1) just logs the
// `/ask?sid=<sid>` URL to stderr instead of launching a browser. We parse that
// URL out of the captured stderr to drive the submit.
//
// Exits non-zero on the first failed assertion.
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Repo root = parent of scripts/ (this file lives in scripts/). Resolve from the
// script location so it works regardless of the caller's cwd.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let assertions = 0;
function assert(cond: unknown, message: string): asserts cond {
  assertions++;
  if (!cond) throw new Error(`assertion failed: ${message}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Pull the single text block out of a callTool result. */
function resultText(res: unknown): string {
  const content = (res as { content?: Array<{ type: string; text?: string }> })
    ?.content;
  const first = content?.[0];
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error(`expected a text result, got: ${JSON.stringify(res)}`);
  }
  return first.text;
}

async function main() {
  const tempDir = await mkdtemp(join(tmpdir(), "browser-plan-smoke-"));
  const sessionsDir = join(tempDir, "sessions");

  // Accumulate the server's stderr so we can parse the /ask?sid=... URL and echo
  // it for debugging on failure.
  let stderrBuf = "";
  let ok = false;

  const transport = new StdioClientTransport({
    command: "node",
    args: ["bin/browser-plan.mjs"],
    cwd: repoRoot,
    env: {
      ...(Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v !== undefined),
      ) as Record<string, string>),
      BROWSER_PLAN_DATA_DIR: tempDir,
      ASK_NO_OPEN: "1",
      ASK_ANSWER_TIMEOUT_MS: "5000",
    },
    stderr: "pipe",
  });

  const client = new Client(
    { name: "browser-plan-smoke", version: "1.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);

  // transport.stderr is a Readable only when stderr: "pipe". Guard for null.
  const serverStderr = transport.stderr;
  if (serverStderr) {
    serverStderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });
  }

  /** List the ask record filenames currently under sessions/<id>/asks/. */
  async function askFiles(sessionId: string): Promise<string[]> {
    const dir = join(sessionsDir, sessionId, "asks");
    if (!(await exists(dir))) return [];
    return (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  }

  /** Read + parse the ask record whose filename was not in `before`. */
  async function readNewAskRecord(
    sessionId: string,
    before: string[],
  ): Promise<{ status: string; answers: Record<string, unknown> | null }> {
    const after = await askFiles(sessionId);
    const added = after.filter((f) => !before.includes(f));
    assert(
      added.length === 1,
      `exactly one new ask record (before=${before.length}, after=${after.length})`,
    );
    const raw = await readFile(
      join(sessionsDir, sessionId, "asks", added[0]!),
      "utf8",
    );
    return JSON.parse(raw);
  }

  try {
    // --- 3. init_browser_plan_session -------------------------------------------
    const initRes = await client.callTool({
      name: "init_browser_plan_session",
      arguments: { projectPath: process.cwd(), title: "smoke", intent: "smoke test" },
    });
    const initText = resultText(initRes);
    const sidMatch = initText.match(/sessionId:\s*([0-9a-f-]+)/i);
    assert(sidMatch, `init returned a "sessionId:" line (got: ${initText})`);
    const sessionId = sidMatch![1]!;
    assert(UUID_RE.test(sessionId), `sessionId is a UUID (got: ${sessionId})`);

    const sessionJsonPath = join(sessionsDir, sessionId, "session.json");
    assert(
      await exists(sessionJsonPath),
      `session.json created at ${sessionJsonPath}`,
    );

    // --- 4. save_plan x2 ---------------------------------------------------
    const save1 = resultText(
      await client.callTool({
        name: "save_plan",
        arguments: { sessionId, plan: "# Plan v1\n\nfirst draft", title: "first" },
      }),
    );
    assert(/\bv1\b/.test(save1), `first save_plan mentions v1 (got: ${save1})`);

    const save2 = resultText(
      await client.callTool({
        name: "save_plan",
        arguments: {
          sessionId,
          plan: "# Plan v2\n\nsecond draft",
          title: "second",
        },
      }),
    );
    assert(/\bv2\b/.test(save2), `second save_plan mentions v2 (got: ${save2})`);

    const plansDir = join(sessionsDir, sessionId, "plans");
    for (const f of ["v1.md", "v2.md", "v1.json", "v2.json"]) {
      assert(await exists(join(plansDir, f)), `plans/${f} exists`);
    }

    const manifest = JSON.parse(await readFile(sessionJsonPath, "utf8"));
    assert(
      manifest.projectPath === process.cwd(),
      `session.json projectPath === cwd (got: ${manifest.projectPath})`,
    );
    assert(
      manifest.latestPlanVersion === 2,
      `session.json latestPlanVersion === 2 (got: ${manifest.latestPlanVersion})`,
    );
    assert(
      manifest.planCount === 2,
      `session.json planCount === 2 (got: ${manifest.planCount})`,
    );

    // --- 5. ask_user — answered path --------------------------------------
    const beforeAnswered = await askFiles(sessionId);
    const askPromise = client.callTool({
      name: "ask_user",
      arguments: {
        sessionId,
        title: "Q",
        questions: [
          { id: "color", kind: "text", label: "fav color?", required: true },
        ],
      },
    });

    // Poll stderr for the direct-open URL the server logs (ASK_NO_OPEN path).
    const urlRe =
      /opening browser directly:\s*(http:\/\/127\.0\.0\.1:\d+)\/ask\?sid=([0-9a-f-]+)/;
    let base: string | undefined;
    let sid: string | undefined;
    for (let i = 0; i < 60 && !base; i++) {
      const m = stderrBuf.match(urlRe);
      if (m) {
        base = m[1];
        sid = m[2];
        break;
      }
      await delay(50);
    }
    assert(base && sid, `parsed /ask?sid=... URL from server stderr`);

    const submitRes = await fetch(`${base}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sid, answers: { color: "blue" } }),
    });
    assert(submitRes.ok, `POST /submit ok (status ${submitRes.status})`);

    const askText = resultText(await askPromise);
    assert(
      askText === JSON.stringify({ color: "blue" }),
      `ask_user returned the answers JSON (got: ${askText})`,
    );

    const answeredRecord = await readNewAskRecord(sessionId, beforeAnswered);
    assert(
      answeredRecord.status === "answered",
      `ask record status === "answered" (got: ${answeredRecord.status})`,
    );
    assert(
      answeredRecord.answers?.color === "blue",
      `ask record answers.color === "blue"`,
    );

    // --- 6. ask_user — timeout path ---------------------------------------
    const beforeTimeout = await askFiles(sessionId);
    const timeoutText = resultText(
      await client.callTool({
        name: "ask_user",
        arguments: {
          sessionId,
          title: "Q2",
          questions: [
            { id: "shape", kind: "text", label: "fav shape?", required: true },
          ],
        },
      }),
    );
    assert(
      /timed out/i.test(timeoutText),
      `ask_user timeout text contains "timed out" (got: ${timeoutText})`,
    );

    const timeoutRecord = await readNewAskRecord(sessionId, beforeTimeout);
    assert(
      timeoutRecord.status === "timeout",
      `ask record status === "timeout" (got: ${timeoutRecord.status})`,
    );

    // --- 7. negatives — unknown session -----------------------------------
    const unknownId = randomUUID();
    const unknownSavePath = join(sessionsDir, unknownId);

    const unknownSave = resultText(
      await client.callTool({
        name: "save_plan",
        arguments: { sessionId: unknownId, plan: "# nope" },
      }),
    );
    assert(
      /init_browser_plan_session/i.test(unknownSave),
      `save_plan unknown session mentions init_browser_plan_session (got: ${unknownSave})`,
    );
    assert(
      !(await exists(unknownSavePath)),
      `save_plan did not create dir for unknown session`,
    );

    const unknownAsk = resultText(
      await client.callTool({
        name: "ask_user",
        arguments: {
          sessionId: unknownId,
          title: "Q3",
          questions: [{ id: "x", kind: "text", label: "x?" }],
        },
      }),
    );
    assert(
      /init_browser_plan_session/i.test(unknownAsk),
      `ask_user unknown session mentions init_browser_plan_session (got: ${unknownAsk})`,
    );
    assert(
      !(await exists(unknownSavePath)),
      `ask_user did not create dir for unknown session`,
    );

    // --- 8. negatives — non-UUID session id -------------------------------
    // The Zod .uuid() validator should reject this at the tool boundary. The SDK
    // may surface it as a thrown error OR an isError result — accept either.
    let rejected = false;
    try {
      const bad = await client.callTool({
        name: "save_plan",
        arguments: { sessionId: "not-a-uuid", plan: "x" },
      });
      rejected = (bad as { isError?: boolean })?.isError === true;
    } catch {
      rejected = true;
    }
    assert(rejected, `save_plan with a non-UUID sessionId errored at the boundary`);

    // --- success ----------------------------------------------------------
    ok = true;
    console.log("SMOKE PASSED");
    console.log(`  assertions:    ${assertions}`);
    console.log(`  data dir:      ${tempDir}`);
    console.log(`  session:       ${sessionId}`);
    console.log(`  session.json:  ${sessionJsonPath}`);
    console.log(`  plans:         ${plansDir}/v{1,2}.{md,json}`);
    console.log(`  asks:          ${join(sessionsDir, sessionId, "asks")}/`);
  } finally {
    // Cleanup: close the client/transport and best-effort remove the temp dir.
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    try {
      await transport.close();
    } catch {
      /* ignore */
    }
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    // On failure, the caller benefits from seeing the server's stderr.
    if (!ok && stderrBuf) {
      console.error("\n--- server stderr ---\n" + stderrBuf);
    }
  }
}

main().catch((err) => {
  process.exitCode = 1;
  console.error(`SMOKE FAILED: ${err instanceof Error ? err.message : String(err)}`);
});
