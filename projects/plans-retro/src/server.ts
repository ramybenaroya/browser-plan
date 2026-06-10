// plans-retro: the browser-plan retrospective reader. A small Express + EJS SSR app
// that browses the sessions the MCP tools persist under ~/.browser-plan. Browsing is
// read-only; the one mutation is an explicit, user-initiated session delete
// (DELETE /api/sessions, a hard `rm -rf` of the session dir). Visual parity with
// ask-user-app comes from serving that app's public/ at /ui (theme styles.css +
// markdown.js pipeline) and reusing its Tailwind class strings in the answer views.
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import {
  listSessions,
  readAsk,
  readPlan,
  assertSession,
  deleteSession,
  isValidSessionId,
  SessionNotFoundError,
} from "../../store";

const here = dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = join(here, "..", "views");
const PUBLIC_DIR = join(here, "..", "public");
// Reuse the form app's assets (theme + client markdown pipeline) as a single
// source of truth — served read-only under /ui.
const ASK_UI_DIR = join(here, "..", "..", "ask-user-app", "public");

const app = express();
app.set("view engine", "ejs");
app.set("views", VIEWS_DIR);

app.use("/ui", express.static(ASK_UI_DIR));
app.use(express.static(PUBLIC_DIR));
app.use(express.json());

/** Wrap an async route so a rejection reaches the Express error handler. */
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

function notFound(res: Response, message: string): void {
  res.status(404).render("error", { title: "404 · browser-plan", status: 404, message });
}

async function sessionTitleOf(sessionId: string): Promise<string> {
  try {
    const s = await assertSession(sessionId);
    return s.title ?? s.sessionId;
  } catch {
    return sessionId;
  }
}

// The dropdown value standing in for sessions with no recorded project path.
const NO_PROJECT = "__none__";
/** A session's project filter key: the path's last segment, or NO_PROJECT. */
function projectKeyOf(projectPath?: string): string {
  return projectPath ? basename(projectPath) : NO_PROJECT;
}

// `/` — every session, newest activity first.
app.get(
  "/",
  wrap(async (_req, res) => {
    const sessions = await listSessions();
    // Distinct project names (last path segment), sorted, for the filter dropdown.
    const projects = [
      ...new Set(
        sessions
          .map((s) => (s.projectPath ? basename(s.projectPath) : null))
          .filter((n): n is string => n !== null),
      ),
    ].sort((a, b) => a.localeCompare(b));
    const hasNoProject = sessions.some((s) => !s.projectPath);
    res.render("index", {
      title: "browser-plan · sessions",
      sessions,
      projects,
      hasNoProject,
      projectKeyOf,
      basename,
      NO_PROJECT,
    });
  }),
);

// `/sessions/:sessionId` — one session: its questionnaires and plans.
app.get(
  "/sessions/:sessionId",
  wrap(async (req, res) => {
    const sessionId = req.params.sessionId ?? "";
    if (!isValidSessionId(sessionId)) return notFound(res, "Session not found.");
    try {
      const session = await assertSession(sessionId);
      res.render("session", {
        title: `${session.title ?? "Session"} · browser-plan`,
        session,
        basename,
      });
    } catch (e) {
      if (e instanceof SessionNotFoundError) {
        return notFound(res, "Session not found.");
      }
      throw e;
    }
  }),
);

// `/sessions/:sessionId/plans/:version` — a saved plan version, rendered.
app.get(
  "/sessions/:sessionId/plans/:version",
  wrap(async (req, res) => {
    const sessionId = req.params.sessionId ?? "";
    const plan = await readPlan(sessionId, Number(req.params.version ?? ""));
    if (plan === null) return notFound(res, "Plan version not found.");
    res.render("plan", {
      title: `${plan.meta.title ?? `Plan v${plan.meta.version}`} · browser-plan`,
      sessionId,
      sessionTitle: await sessionTitleOf(sessionId),
      meta: plan.meta,
      markdown: plan.markdown,
    });
  }),
);

// `/sessions/:sessionId/q/:askId` — the questionnaire page. The chrome (title,
// status, notice) is SSR here; the questionnaire itself is rendered by the live
// ask-user form, embedded read-only in a same-origin iframe (see the view).
app.get(
  "/sessions/:sessionId/q/:askId",
  wrap(async (req, res) => {
    const sessionId = req.params.sessionId ?? "";
    const askId = req.params.askId ?? "";
    const ask = await readAsk(sessionId, askId);
    if (ask === null) return notFound(res, "Questionnaire not found.");
    res.render("questionnaire", {
      title: `${ask.title || "Questionnaire"} · browser-plan`,
      sessionId,
      askId,
      sessionTitle: await sessionTitleOf(sessionId),
      ask,
    });
  }),
);

// `/sessions/:sessionId/q/:askId/spec.json` — the questionnaire spec plus the
// stored answers, fed to the embedded ask-user form (its `src` in the iframe).
app.get(
  "/sessions/:sessionId/q/:askId/spec.json",
  wrap(async (req, res) => {
    const sessionId = req.params.sessionId ?? "";
    if (!isValidSessionId(sessionId)) return res.status(404).json({ error: "not found" });
    const ask = await readAsk(sessionId, req.params.askId ?? "");
    if (ask === null) return res.status(404).json({ error: "not found" });
    res.json({ ...ask.input, answers: ask.answers, status: ask.status });
  }),
);

// `DELETE /api/sessions` — hard-delete one or more sessions by id. Handles both
// the per-row delete (a single id) and bulk delete (many) from the list page.
// Non-string / non-UUID ids are dropped by the guard; deleteSession is idempotent.
app.delete(
  "/api/sessions",
  wrap(async (req, res) => {
    const ids: unknown = (req.body as { ids?: unknown } | undefined)?.ids;
    const list = Array.isArray(ids)
      ? ids.filter((x): x is string => typeof x === "string" && isValidSessionId(x))
      : [];
    await Promise.all(list.map((id) => deleteSession(id)));
    res.json({ deleted: list });
  }),
);

// Unmatched routes → styled 404.
app.use((_req, res) => notFound(res, "Page not found."));

// Anything thrown by a route → styled 500.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[plans-retro] error:", err);
  res.status(500).render("error", {
    title: "500 · browser-plan",
    status: 500,
    message: "Something went wrong reading this page.",
  });
});

const PORT = Number(process.env.PORT ?? 4317);
app.listen(PORT, "127.0.0.1", () => {
  console.log(`[plans-retro] listening on http://127.0.0.1:${PORT}`);
});
