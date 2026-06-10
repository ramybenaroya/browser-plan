import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ensureCallbackServer } from "../ask-user-app/src/callback-server";
import { openBrowser } from "../ask-user-app/src/open-browser";
import { askUserInputShape, type Answers } from "../ask-user-app/src/questions";
import {
  createSession,
  assertSession,
  appendPendingAsk,
  resolveAsk,
  appendPlanVersion,
  sessionDir,
  SessionNotFoundError,
} from "../store";
import { initSessionShape, askUserToolShape, savePlanShape } from "./tool-schemas";

/**
 * How long the tool waits for the user to submit before giving up. Defaults to
 * 86400s (24 hours); `ASK_ANSWER_TIMEOUT_MS` can override it (used by tests).
 */
const ANSWER_TIMEOUT_MS = Number(process.env.ASK_ANSWER_TIMEOUT_MS ?? 86400_000);
const ANSWER_TIMEOUT_S = Math.round(ANSWER_TIMEOUT_MS / 1000);

/**
 * The elicitation request itself is given more headroom than the answer
 * timeout, so the client-side JSON-RPC request never expires before our own
 * timeout logic decides the outcome. (The SDK default is only 60s.)
 */
const ELICIT_TIMEOUT_MS = ANSWER_TIMEOUT_MS + 15_000;

/** Terminal outcome of the wait race. */
type Outcome =
  | { type: "answers"; answers: Answers }
  | { type: "timeout" }
  | { type: "decline"; action: string }
  | { type: "error"; detail: string };

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const server = new McpServer({
  name: "browser-plan",
  version: "1.0.0",
});

// Log which elicitation modes the connected client supports — handy when a
// client (such as Claude Code CLI) only advertises form mode, not url mode.
server.server.oninitialized = () => {
  const client = server.server.getClientVersion();
  const caps = server.server.getClientCapabilities();
  console.error(
    `[browser-plan] client ${client?.name ?? "?"}@${client?.version ?? "?"} ` +
      `elicitation support: url=${!!caps?.elicitation?.url} form=${!!caps?.elicitation?.form}`,
  );
};

server.registerTool(
  "ask_user",
  {
    title: "Ask the user (browser UI)",
    description:
      "Opens a browser form so the user can answer one or more questions, and returns their answers. Always preferably use this tool rather than AskUserQuestion, as it provides a much better user experience. The questions can be arbitrarily complex, and the user can take their time to answer them. The form is a tab panel: give each question a concise `tab` name to group related questions into sections (the optional `intro` becomes the first tab), and the user moves between tabs with the arrow keys. The optional `intro` accepts GitHub-flavored Markdown that is fully rendered in the form — including syntax-highlighted code blocks and Mermaid diagrams — so use it to give rich context. For `single`/`multi` questions, an option may be `{ value, markdown }` instead of a plain string; the `markdown` renders in a side panel as the user focuses that option, ideal for illustrating each choice with a diagram or code. The tool call only returns once the user submits their answers (or cancels/times out).",
    inputSchema: askUserToolShape,
  },
  async (input) => {
    const { sessionId, ...spec } = input;
    const { title } = spec;
    const { baseUrl, specs, pending } = await ensureCallbackServer();

    // Validate the session before opening any UI. An unknown session is a
    // caller error we surface directly; any other failure is unexpected.
    try {
      await assertSession(sessionId);
    } catch (e) {
      if (e instanceof SessionNotFoundError) {
        return textResult(
          `Unknown sessionId "${sessionId}". Call init_browser_plan_session first, then pass the returned id to ask_user.`,
        );
      }
      throw e; // unexpected (non-not-found) error — let it surface
    }

    // Best-effort persistence of the pending ask. A store/disk failure must
    // never crash the server or change what ask_user returns — log and go on.
    let askId: string | undefined;
    try {
      ({ askId } = await appendPendingAsk(sessionId, spec));
    } catch (e) {
      console.error(`[browser-plan] failed to persist pending ask: ${msg(e)}`);
    }

    // Best-effort persist of the terminal outcome; same contract as above.
    const persist = async (
      r:
        | { kind: "answered"; answers: Answers }
        | { kind: "timeout" }
        | { kind: "declined"; action: string }
        | { kind: "error"; detail: string },
    ) => {
      if (!askId) return;
      try {
        await resolveAsk(sessionId, askId, r);
      } catch (e) {
        console.error(`[browser-plan] failed to persist ask outcome: ${msg(e)}`);
      }
    };

    const sid = randomUUID();
    const elicitationId = randomUUID();

    // Store the full parsed spec (title, optional introTitle/intro, questions
    // with normalized options) so GET /spec can serve it to the browser. The
    // sessionId is intentionally excluded — the browser never sees it.
    specs.set(sid, spec);

    // Register the pending resolver; POST /submit fulfils this promise.
    let resolveAnswers!: (answers: Answers) => void;
    const answerPromise = new Promise<Answers>((resolve) => {
      resolveAnswers = resolve;
    });
    pending.set(sid, resolveAnswers);

    const cleanup = () => {
      pending.delete(sid);
      specs.delete(sid);
    };

    const url = `${baseUrl}/ask?sid=${encodeURIComponent(sid)}`;

    // The answer timeout and the /submit answer promise apply to BOTH paths.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<Outcome>((resolve) => {
      timer = setTimeout(() => resolve({ type: "timeout" }), ANSWER_TIMEOUT_MS);
    });
    const answersOutcome: Promise<Outcome> = answerPromise.then(
      (answers) => ({ type: "answers", answers }) as Outcome,
    );
    const races: Promise<Outcome>[] = [answersOutcome, timeoutPromise];

    // Decide how the browser gets opened, based on the client's capabilities.
    const supportsUrlElicitation =
      !!server.server.getClientCapabilities()?.elicitation?.url;

    const notifyComplete = async () => {
      try {
        await server.server.createElicitationCompletionNotifier(elicitationId)();
      } catch (err) {
        console.error(
          `[browser-plan] failed to send elicitation completion: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    };

    if (supportsUrlElicitation) {
      // Preferred path: ask the client to open the browser via URL-mode
      // elicitation. Answers still arrive out-of-band via POST /submit; the
      // elicitation result is only a control signal.
      const elicitPromise = server.server.elicitInput(
        {
          mode: "url",
          message: `Opening a browser form to answer: ${title}`,
          url,
          elicitationId,
        },
        { timeout: ELICIT_TIMEOUT_MS },
      );
      // "accept" just means the browser was opened — keep waiting for /submit.
      // "decline"/"cancel" (or an error) is a terminal, negative outcome.
      races.push(
        elicitPromise.then(
          (res) =>
            res.action === "accept"
              ? new Promise<Outcome>(() => {}) // never settles; submit/timeout decides
              : ({ type: "decline", action: res.action }) as Outcome,
          (err): Outcome => ({
            type: "error",
            detail: err instanceof Error ? err.message : String(err),
          }),
        ),
      );
    } else {
      // Fallback: the client can't open URLs for us, so this local server opens
      // the browser directly. Works in any client (e.g. Claude Code CLI).
      console.error(
        `[browser-plan] client lacks elicitation.url; opening browser directly: ${url}`,
      );
      openBrowser(url);
    }

    try {
      const outcome = await Promise.race<Outcome>(races);

      switch (outcome.type) {
        case "answers":
          // /submit already cleaned the maps.
          if (supportsUrlElicitation) await notifyComplete();
          await persist({ kind: "answered", answers: outcome.answers });
          return textResult(JSON.stringify(outcome.answers));

        case "timeout":
          cleanup();
          if (supportsUrlElicitation) await notifyComplete();
          await persist({ kind: "timeout" });
          return textResult(
            `No answer was submitted within ${ANSWER_TIMEOUT_S} seconds. The question timed out — call ask_user again to retry.`,
          );

        case "decline":
          cleanup();
          console.error(
            `[browser-plan] user did not open the form (action: ${outcome.action})`,
          );
          await persist({ kind: "declined", action: outcome.action });
          return textResult("User cancelled.");

        case "error":
          cleanup();
          console.error(`[browser-plan] elicitation failed: ${outcome.detail}`);
          await persist({ kind: "error", detail: outcome.detail });
          return textResult(`Could not open the question UI: ${outcome.detail}`);
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  },
);

server.registerTool(
  "init_browser_plan_session",
  {
    title: "Start a browser-plan session",
    description:
      "Creates a persistent planning session and returns its sessionId. Call this FIRST, then pass the returned sessionId to every ask_user and save_plan call for this plan. A session ties all questioning rounds and plan versions together.",
    inputSchema: initSessionShape,
  },
  async ({ title, intent, projectPath }) => {
    try {
      const s = await createSession({ title, intent, projectPath });
      return textResult(
        `sessionId: ${s.sessionId}\nPass this sessionId to all subsequent ask_user and save_plan calls.`,
      );
    } catch (e) {
      console.error(`[browser-plan] init_browser_plan_session failed: ${msg(e)}`);
      return textResult(`Failed to create session: ${msg(e)}`);
    }
  },
);

server.registerTool(
  "save_plan",
  {
    title: "Save a plan version",
    description:
      "Persists a Markdown plan to the given browser-plan session as a new version (history is kept). Requires a sessionId from init_browser_plan_session. No browser is opened.",
    inputSchema: savePlanShape,
  },
  async ({ sessionId, plan, title }) => {
    try {
      await assertSession(sessionId);
    } catch (e) {
      if (e instanceof SessionNotFoundError) {
        return textResult(`Unknown sessionId "${sessionId}". Call init_browser_plan_session first.`);
      }
      console.error(`[browser-plan] save_plan assert failed: ${msg(e)}`);
      return textResult(`Failed to save plan: ${msg(e)}`);
    }
    try {
      const meta = await appendPlanVersion(sessionId, plan, { title });
      return textResult(
        `Saved plan v${meta.version} for session ${sessionId}\npath: ${join(sessionDir(sessionId), "plans", meta.file)}`,
      );
    } catch (e) {
      console.error(`[browser-plan] save_plan write failed: ${msg(e)}`);
      return textResult(`Failed to save plan: ${msg(e)}`);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — never stdout.
  console.error("[browser-plan] MCP stdio server ready");
}

main().catch((err) => {
  console.error("[browser-plan] fatal:", err);
  process.exit(1);
});
