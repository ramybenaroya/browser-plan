import { z } from "zod";
import { askUserInputShape } from "../ask-user-app/src/questions";

const sessionId = z
  .string()
  .uuid("sessionId must be the UUID returned by init_browser_plan_session");

/** init_browser_plan_session — projectPath required, title/intent optional. */
export const initSessionShape = {
  projectPath: z
    .string()
    .min(1)
    .describe(
      "Absolute filesystem path of the project / working directory this plan is for (e.g. the repo root). The retro viewer displays and filters by the last path segment.",
    ),
  title: z
    .string()
    .min(1)
    .describe("Optional short title for this planning session.")
    .optional(),
  intent: z
    .string()
    .min(1)
    .describe("Optional one-line description of what you are planning.")
    .optional(),
} as const;

/**
 * ask_user wrapper: the shared question spec PLUS sessionId. The handler strips
 * sessionId before storing the spec for the browser, so GET /spec never sees it.
 */
export const askUserToolShape = {
  sessionId: sessionId.describe(
    "The session id from init_browser_plan_session. Call that tool first if you don't have one.",
  ),
  ...askUserInputShape,
} as const;

/** save_plan. */
export const savePlanShape = {
  sessionId,
  plan: z
    .string()
    .min(1, "plan markdown must not be empty")
    .describe("The full plan as a Markdown string. Persisted as a new version each call."),
  title: z.string().min(1).describe("Optional title for this plan version.").optional(),
} as const;
