import express from "express";
import cors from "cors";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import type { AskUserInput, Answers } from "./questions";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, "..", "public");

/** Called by POST /submit to hand answers back to the waiting tool call. */
export type Resolver = (answers: Answers) => void;

export interface CallbackServer {
  /** e.g. http://127.0.0.1:54321 */
  baseUrl: string;
  /** Question specs keyed by session id, served by GET /spec. */
  specs: Map<string, AskUserInput>;
  /** Pending tool-call resolvers keyed by session id. */
  pending: Map<string, Resolver>;
}

let cached: CallbackServer | null = null;
let starting: Promise<CallbackServer> | null = null;

/**
 * Lazily start the local callback HTTP server. Idempotent: the server is
 * created once per process (bound to an ephemeral 127.0.0.1 port) and the same
 * instance is returned on every subsequent call.
 */
export function ensureCallbackServer(): Promise<CallbackServer> {
  if (cached) return Promise.resolve(cached);
  if (!starting) starting = startServer();
  return starting;
}

function startServer(): Promise<CallbackServer> {
  return new Promise<CallbackServer>((resolve, reject) => {
    const specs = new Map<string, AskUserInput>();
    const pending = new Map<string, Resolver>();

    const app = express();
    app.use(cors());
    app.use(express.json({ limit: "1mb" }));

    // The question UI shell. The page reads `sid` from the query string and
    // then fetches /spec to render itself.
    app.get("/ask", (_req, res) => {
      res.sendFile(join(PUBLIC_DIR, "index.html"));
    });

    // The question spec for a given session.
    app.get("/spec", (req, res) => {
      const sid = typeof req.query.sid === "string" ? req.query.sid : "";
      const spec = specs.get(sid);
      if (!spec) {
        res.status(404).json({ error: "unknown or expired session" });
        return;
      }
      res.json(spec);
    });

    // Out-of-band answer submission. Resolves the waiting tool call.
    app.post("/submit", (req, res) => {
      const body = (req.body ?? {}) as { sid?: unknown; answers?: unknown };
      const sid = typeof body.sid === "string" ? body.sid : "";
      const resolver = pending.get(sid);
      if (!resolver) {
        res.status(404).json({ error: "unknown or expired session" });
        return;
      }
      // Free the maps before resolving so a late duplicate POST gets a 404.
      pending.delete(sid);
      specs.delete(sid);
      resolver((body.answers ?? {}) as Answers);
      res.json({ ok: true });
    });

    // Static assets (styles.css, app.js, and index.html at "/").
    app.use(express.static(PUBLIC_DIR));

    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${port}`;
      // stderr only — stdout is reserved for the JSON-RPC protocol stream.
      console.error(`[browser-plan] callback server listening on ${baseUrl}`);
      cached = { baseUrl, specs, pending };
      resolve(cached);
    });

    server.on("error", (err) => {
      starting = null;
      reject(err);
    });
  });
}
