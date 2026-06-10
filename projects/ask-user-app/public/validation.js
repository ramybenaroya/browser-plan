// Pure, framework-free answer helpers. Shared by the form components.
//
// Answer value types per question kind:
//   text / longtext -> string
//   single          -> string
//   multi           -> string[]
//   scale           -> number

/** The initial value stored for a question before the user touches it. */
export function defaultValueFor(q) {
  switch (q.kind) {
    case "text":
    case "longtext":
    case "single":
      return "";
    case "multi":
      return [];
    case "scale":
      return q.min;
    default:
      return "";
  }
}

/** Whether a question currently holds a usable answer (drives `required`). */
export function isAnswered(q, v) {
  switch (q.kind) {
    case "text":
    case "longtext":
      return typeof v === "string" && v.trim().length > 0;
    case "single":
      return typeof v === "string" && v.length > 0;
    case "multi":
      return Array.isArray(v) && v.length > 0;
    case "scale":
      return typeof v === "number";
    default:
      return true;
  }
}

/** True when every `required` question has an answer. */
export function allRequiredAnswered(questions, answers) {
  return questions.every((q) => !q.required || isAnswered(q, answers[q.id]));
}
