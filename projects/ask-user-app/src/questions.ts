import { z } from "zod";

/**
 * The five supported question kinds (v1). A `Question` is a discriminated union
 * on `kind`. The `id` is unique within a spec and becomes the key in the
 * returned answers object.
 *
 * Answer value types:
 *   text / longtext -> string
 *   single          -> string   (the chosen option's `value`)
 *   multi           -> string[] (the chosen options' `value`s)
 *   scale           -> number
 */

const id = z.string().min(1, "question id must not be empty");
const label = z.string().min(1, "question label must not be empty");

/**
 * Fields common to every question kind. `tab` groups questions into a named
 * section/tab in the form; questions that share a `tab` value render together
 * and tab order follows first appearance.
 */
const base = {
  id,
  label,
  required: z.boolean().optional(),
  tab: z
    .string()
    .min(1)
    .describe(
      "Optional section name. Questions sharing the same `tab` value are grouped " +
        "into one tab in the form; tab order follows first appearance. Keep it " +
        "very concise (e.g. 'Backend', 'Rollout', 'Sign-off').",
    )
    .optional(),
};

/**
 * A choice option: either a bare string, or an object that can attach an
 * optional Markdown "illustration". Both forms normalize to `{ value, markdown? }`
 * so the rest of the app only ever deals with the object form. The returned
 * answer is always the option's `value` string.
 */
const option = z
  .union([
    z.string().min(1),
    z.object({
      value: z.string().min(1, "option value must not be empty"),
      markdown: z
        .string()
        .describe(
          "Optional GitHub-flavored Markdown shown in a side panel when this " +
            "option is focused — rendered with the same engine as `intro` " +
            "(headings, lists, tables, syntax-highlighted code, and diagrams as " +
            "either ```mermaid or a plain-text/ASCII ```text block).",
        )
        .optional(),
    }),
  ])
  .transform((o) => (typeof o === "string" ? { value: o } : o));

const textQuestion = z.object({
  ...base,
  kind: z.literal("text"),
  placeholder: z.string().optional(),
});

const longtextQuestion = z.object({
  ...base,
  kind: z.literal("longtext"),
  placeholder: z.string().optional(),
});

const singleQuestion = z.object({
  ...base,
  kind: z.literal("single"),
  options: z.array(option).min(1, "single requires at least one option"),
});

const multiQuestion = z.object({
  ...base,
  kind: z.literal("multi"),
  options: z.array(option).min(1, "multi requires at least one option"),
});

const scaleQuestion = z.object({
  ...base,
  kind: z.literal("scale"),
  min: z.number(),
  max: z.number(),
  step: z.number().positive().optional(),
});

export const questionSchema = z.discriminatedUnion("kind", [
  textQuestion,
  longtextQuestion,
  singleQuestion,
  multiQuestion,
  scaleQuestion,
]);

export type Question = z.infer<typeof questionSchema>;

/**
 * Tool input as a ZodRawShape, ready to hand to `registerTool`'s `inputSchema`.
 */
export const askUserInputShape = {
  title: z.string().min(1, "title must not be empty"),
  introTitle: z
    .string()
    .min(1)
    .describe(
      "Optional concise title for the intro tab (defaults to 'Overview'). Only " +
        "used when `intro` is provided.",
    )
    .optional(),
  intro: z
    .string()
    .describe(
      "Optional intro shown as the first tab. Supports GitHub-flavored Markdown, " +
        "fully rendered in the browser form: headings, lists, tables, links, " +
        "syntax-highlighted code blocks (```js, ```python, ```ts, ```tsx), and " +
        "diagrams. For diagrams, pick whichever style fits what you're " +
        "explaining: a Mermaid diagram (```mermaid) for flowcharts, sequences, " +
        "graphs, etc., or a plain-text/ASCII sketch in a ```text block when a " +
        "quick hand-drawn layout reads more clearly.",
    )
    .optional(),
  questions: z
    .array(questionSchema)
    .min(1, "at least one question is required")
    .max(20, "at most 20 questions are allowed")
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((q, idx) => {
        if (seen.has(q.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `duplicate question id: ${q.id}`,
            path: [idx, "id"],
          });
        }
        seen.add(q.id);
        if (q.kind === "scale" && q.max <= q.min) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "scale max must be greater than min",
            path: [idx, "max"],
          });
        }
        if (q.kind === "single" || q.kind === "multi") {
          const values = new Set<string>();
          q.options.forEach((opt, optIdx) => {
            if (values.has(opt.value)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `duplicate option value: ${opt.value}`,
                path: [idx, "options", optIdx, "value"],
              });
            }
            values.add(opt.value);
          });
        }
      });
    }),
} as const;

export const askUserInputSchema = z.object(askUserInputShape);
export type AskUserInput = z.infer<typeof askUserInputSchema>;

/** The shape returned to the calling agent: `{ [questionId]: answerValue }`. */
export type Answers = Record<string, string | string[] | number>;
