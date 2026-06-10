// Client behavior for the sessions list (index page only). Dependency-free,
// plain DOM — no imports, styled via retro.css. Provides fuzzy search over the
// rows' data-search text, select-all / per-row selection, and hard delete (single
// + bulk) via DELETE /api/sessions, reloading on success so the server re-renders
// in last-updated order (and shows the empty state once the last one is gone).

const search = document.getElementById("session-search");
const projectFilter = document.getElementById("project-filter");
const selectAll = document.getElementById("select-all");
const bulkDelete = document.getElementById("bulk-delete");
const selectedCount = document.getElementById("selected-count");
const noResults = document.getElementById("no-results");
const rows = () => Array.from(document.querySelectorAll("tr[data-id]"));

/** True if every char of `needle` appears in order within `word`. */
function subsequence(needle, word) {
  let i = 0;
  for (let j = 0; j < word.length && i < needle.length; j++) {
    if (word[j] === needle[i]) i++;
  }
  return i === needle.length;
}

// Pre-split each row's search text into words once. Matching a token as a
// subsequence *within a single word* keeps real fuzziness ("dshbrd" → the word
// "dashboard") while avoiding the absurdly loose matches a whole-string
// subsequence produces (e.g. "oauth" spanning "dashb-o-ard … l-a-yo-u-t … wi-th").
const wordsByRow = new Map();
function wordsFor(row) {
  let words = wordsByRow.get(row);
  if (words === undefined) {
    words = (row.dataset.search || "").split(/\s+/).filter(Boolean);
    wordsByRow.set(row, words);
  }
  return words;
}

/** Fuzzy match: every query token must subsequence-match some word in `words`. */
function matches(query, words) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((t) => words.some((w) => subsequence(t, w)));
}

const visibleRows = () => rows().filter((r) => !r.hidden);

/** Reflect selection in the count, the bulk button, and the select-all state. */
function refreshSelectionState() {
  const visible = visibleRows();
  const checked = visible.filter((r) => r.querySelector(".row-select").checked);
  for (const r of rows()) {
    r.classList.toggle("selected", r.querySelector(".row-select").checked);
  }
  selectedCount.textContent = checked.length ? `${checked.length} selected` : "";
  bulkDelete.disabled = checked.length === 0;
  selectAll.checked = visible.length > 0 && checked.length === visible.length;
  selectAll.indeterminate = checked.length > 0 && checked.length < visible.length;
}

function applyFilter() {
  const query = search.value.trim();
  const want = projectFilter ? projectFilter.value : "__all__";
  let anyVisible = false;
  for (const r of rows()) {
    const projOk = want === "__all__" || r.dataset.project === want;
    const hit = projOk && (query === "" || matches(query, wordsFor(r)));
    r.hidden = !hit;
    if (hit) anyVisible = true;
    // A row the user can no longer see shouldn't stay in the delete selection.
    if (!hit) r.querySelector(".row-select").checked = false;
  }
  noResults.hidden = anyVisible;
  refreshSelectionState();
}

/** Confirm, then hard-delete `ids`; reload on success. */
async function deleteIds(ids, message) {
  if (ids.length === 0 || !confirm(message)) return;
  try {
    const res = await fetch("/api/sessions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    location.reload();
  } catch (err) {
    alert(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
  }
}

search.addEventListener("input", applyFilter);
projectFilter?.addEventListener("change", applyFilter);

selectAll.addEventListener("change", () => {
  for (const r of visibleRows()) r.querySelector(".row-select").checked = selectAll.checked;
  refreshSelectionState();
});

for (const r of rows()) {
  r.querySelector(".row-select").addEventListener("change", refreshSelectionState);
  r.querySelector(".btn-row-delete").addEventListener("click", () => {
    const title = r.querySelector(".btn-row-delete").dataset.title || "this session";
    deleteIds(
      [r.dataset.id],
      `Delete session "${title}"?\n\nThis permanently removes its plans and questionnaires.`,
    );
  });
}

bulkDelete.addEventListener("click", () => {
  const ids = visibleRows()
    .filter((r) => r.querySelector(".row-select").checked)
    .map((r) => r.dataset.id);
  deleteIds(
    ids,
    `Delete ${ids.length} selected session${ids.length === 1 ? "" : "s"}?\n\n` +
      `This permanently removes their plans and questionnaires.`,
  );
});

refreshSelectionState();
