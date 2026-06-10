/**
 * Self-contained runnable test for the browser-plan session store. NOT a test-runner
 * harness — run directly with:
 *
 *   npx tsx projects/store/store.test.ts
 *
 * It points BROWSER_PLAN_DATA_DIR at a fresh temp dir BEFORE importing the store
 * (so `dataRoot()` resolves there), exercises the full CRUD surface with
 * `node:assert/strict`, logs PASS lines, and `process.exit(1)`s on any failure.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AskUserInput } from "../ask-user-app/src/questions";
import type { AskRecord, SessionRecord } from "./types";

/** Resolve a path under the active data root for a session. */
let DATA_DIR = "";
function sessionFile(sessionId: string, rel: string): string {
  return join(DATA_DIR, "sessions", sessionId, rel);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

const SAMPLE_INPUT: AskUserInput = {
  title: "Pick a backend",
  intro: "# Choose\nPick the backend and timeline.",
  questions: [
    { id: "db", kind: "single", label: "Which DB?", options: [{ value: "pg" }, { value: "mysql" }] },
    { id: "notes", kind: "longtext", label: "Any notes?" },
    { id: "scale", kind: "scale", label: "Confidence", min: 1, max: 5 },
  ],
};

let pass = 0;
function ok(msg: string): void {
  pass += 1;
  console.log(`PASS: ${msg}`);
}

async function main(): Promise<void> {
  DATA_DIR = await mkdtemp(join(tmpdir(), "browser-plan-store-test-"));
  process.env.BROWSER_PLAN_DATA_DIR = DATA_DIR;

  // Import the store ONLY after the env var is set so dataRoot() resolves here.
  const store = await import("./index");
  const { SessionNotFoundError } = store;

  // --- createSession -> assertSession round-trips -------------------------
  const created = await store.createSession({
    projectPath: "/tmp/projects/my-repo",
    title: "My session",
    intent: "build x",
  });
  assert.ok(store.isValidSessionId(created.sessionId), "createSession mints a UUID");
  assert.equal(created.schemaVersion, 1);
  assert.equal(created.projectPath, "/tmp/projects/my-repo");
  assert.equal(created.title, "My session");
  assert.equal(created.intent, "build x");
  assert.equal(created.latestPlanVersion, null);
  assert.equal(created.planCount, 0);
  assert.equal(created.askCount, 0);
  assert.deepEqual(created.asks, []);
  assert.deepEqual(created.plans, []);
  assert.ok(await exists(sessionFile(created.sessionId, "session.json")), "session.json written");
  ok("createSession writes session.json with empty indexes");

  const fetched = await store.assertSession(created.sessionId);
  assert.equal(fetched.sessionId, created.sessionId);
  assert.deepEqual(fetched, created);
  ok("assertSession returns the created record");

  // --- negative assertSession --------------------------------------------
  await assert.rejects(
    () => store.assertSession("not-a-uuid"),
    (e: unknown) => e instanceof SessionNotFoundError,
    "invalid id throws SessionNotFoundError",
  );
  ok("assertSession('not-a-uuid') throws SessionNotFoundError");

  await assert.rejects(
    () => store.assertSession(randomUUID()),
    (e: unknown) => e instanceof SessionNotFoundError,
    "unknown uuid throws SessionNotFoundError",
  );
  ok("assertSession(<unknown uuid>) throws SessionNotFoundError");

  // --- appendPendingAsk ---------------------------------------------------
  const { askId, file } = await store.appendPendingAsk(created.sessionId, SAMPLE_INPUT);
  assert.ok(store.isValidSessionId(askId), "askId is a UUID");
  assert.match(file, /^asks\/\d{8}T\d{9}Z-/, "ask file uses compact UTC ts");
  assert.ok(await exists(sessionFile(created.sessionId, file)), "ask record file exists");

  const askRec = await readJson<AskRecord>(sessionFile(created.sessionId, file));
  assert.equal(askRec.status, "pending");
  assert.equal(askRec.answeredAt, null);
  assert.equal(askRec.answers, null);
  assert.equal(askRec.outcome, null);
  assert.equal(askRec.title, SAMPLE_INPUT.title);
  assert.equal(askRec.askId, askId);
  assert.equal(askRec.sessionId, created.sessionId);
  assert.deepEqual(askRec.input, SAMPLE_INPUT, "full input persisted");

  const afterAsk = await readJson<SessionRecord>(sessionFile(created.sessionId, "session.json"));
  assert.equal(afterAsk.askCount, 1);
  assert.equal(afterAsk.asks.length, 1);
  assert.equal(afterAsk.asks[0]?.askId, askId);
  assert.equal(afterAsk.asks[0]?.status, "pending");
  assert.equal(afterAsk.asks[0]?.file, file);
  assert.ok(afterAsk.updatedAt >= created.updatedAt, "updatedAt bumped");
  ok("appendPendingAsk writes a pending record + index entry, bumps askCount");

  // --- resolveAsk for each of the 4 kinds (separate asks) -----------------
  // answered
  {
    const a = await store.appendPendingAsk(created.sessionId, SAMPLE_INPUT);
    await store.resolveAsk(created.sessionId, a.askId, {
      kind: "answered",
      answers: { db: "pg", notes: "go", scale: 4 },
    });
    const rec = await readJson<AskRecord>(sessionFile(created.sessionId, a.file));
    assert.equal(rec.status, "answered");
    assert.ok(rec.answeredAt !== null, "answeredAt set");
    assert.deepEqual(rec.answers, { db: "pg", notes: "go", scale: 4 });
    assert.equal(rec.outcome, null);
    const s = await readJson<SessionRecord>(sessionFile(created.sessionId, "session.json"));
    const entry = s.asks.find((x) => x.askId === a.askId);
    assert.equal(entry?.status, "answered");
    assert.ok(entry?.answeredAt !== null);
    ok("resolveAsk kind=answered -> status answered + answers");
  }
  // timeout
  {
    const a = await store.appendPendingAsk(created.sessionId, SAMPLE_INPUT);
    await store.resolveAsk(created.sessionId, a.askId, { kind: "timeout" });
    const rec = await readJson<AskRecord>(sessionFile(created.sessionId, a.file));
    assert.equal(rec.status, "timeout");
    assert.ok(rec.answeredAt !== null);
    assert.equal(rec.answers, null);
    assert.deepEqual(rec.outcome, { type: "timeout" });
    ok("resolveAsk kind=timeout -> status timeout + outcome{type:timeout}");
  }
  // declined
  {
    const a = await store.appendPendingAsk(created.sessionId, SAMPLE_INPUT);
    await store.resolveAsk(created.sessionId, a.askId, { kind: "declined", action: "cancel" });
    const rec = await readJson<AskRecord>(sessionFile(created.sessionId, a.file));
    assert.equal(rec.status, "declined");
    assert.ok(rec.answeredAt !== null);
    assert.equal(rec.answers, null);
    assert.deepEqual(rec.outcome, { type: "decline", action: "cancel" });
    ok("resolveAsk kind=declined -> status declined + outcome{type:decline,action}");
  }
  // error
  {
    const a = await store.appendPendingAsk(created.sessionId, SAMPLE_INPUT);
    await store.resolveAsk(created.sessionId, a.askId, { kind: "error", detail: "boom" });
    const rec = await readJson<AskRecord>(sessionFile(created.sessionId, a.file));
    assert.equal(rec.status, "error");
    assert.ok(rec.answeredAt !== null);
    assert.equal(rec.answers, null);
    assert.deepEqual(rec.outcome, { type: "error", detail: "boom" });
    ok("resolveAsk kind=error -> status error + outcome{type:error,detail}");
  }

  // --- appendPlanVersion twice -------------------------------------------
  const m1 = await store.appendPlanVersion(created.sessionId, "# Plan v1\nhello", { title: "first" });
  assert.equal(m1.version, 1);
  assert.equal(m1.file, "v1.md");
  assert.equal(m1.title, "first");
  assert.equal(m1.bytes, Buffer.byteLength("# Plan v1\nhello", "utf8"));
  assert.ok(await exists(sessionFile(created.sessionId, "plans/v1.md")), "v1.md exists");
  assert.ok(await exists(sessionFile(created.sessionId, "plans/v1.json")), "v1.json exists");
  assert.equal(await readFile(sessionFile(created.sessionId, "plans/v1.md"), "utf8"), "# Plan v1\nhello");

  const m2 = await store.appendPlanVersion(created.sessionId, "# Plan v2 — longer ✓", {});
  assert.equal(m2.version, 2);
  assert.equal(m2.file, "v2.md");
  assert.equal(m2.title, undefined);
  assert.equal(m2.bytes, Buffer.byteLength("# Plan v2 — longer ✓", "utf8"));
  assert.ok(await exists(sessionFile(created.sessionId, "plans/v2.md")), "v2.md exists");
  assert.ok(await exists(sessionFile(created.sessionId, "plans/v2.json")), "v2.json exists");

  const finalSession = await readJson<SessionRecord>(sessionFile(created.sessionId, "session.json"));
  assert.equal(finalSession.latestPlanVersion, 2);
  assert.equal(finalSession.planCount, 2);
  assert.equal(finalSession.plans.length, 2);
  assert.equal(finalSession.plans[0]?.version, 1);
  assert.equal(finalSession.plans[0]?.file, "plans/v1.md");
  assert.equal(finalSession.plans[0]?.title, "first");
  assert.equal(finalSession.plans[1]?.version, 2);
  assert.equal(finalSession.plans[1]?.file, "plans/v2.md");
  ok("appendPlanVersion x2 -> v1/v2 md+json, latestPlanVersion=2, planCount=2, bytes correct, index entries present");

  console.log(`\nALL ${pass} CHECKS PASSED`);
}

main()
  .then(async () => {
    if (DATA_DIR) await rm(DATA_DIR, { recursive: true, force: true }).catch(() => {});
  })
  .catch(async (err) => {
    console.error("TEST FAILED:", err);
    if (DATA_DIR) await rm(DATA_DIR, { recursive: true, force: true }).catch(() => {});
    process.exit(1);
  });
