// readPlanBoard — docs/design-web-agent.md § 18 (amended 2026-09-26): the
// one reader behind Home's plan sections (design-web-ui.md § 5.3) and
// `parsePlanTodo` (helpers.ts), so the app never carries two disagreeing
// parsers of plan.md's board (rule 12). Waiting on you reuses
// check_closeout's own `waitingRows`, unchanged, the way the Jobs page
// reuses the jobs_md port's `load()`. Runs in the browser AND on a
// server — no window/document/localStorage/node:* import (§ 1's rule
// covers this file too, since it's reachable from src/index.ts).
//
// splitPlanMinutes/budgetMinutesPerDay — § 18.1 (the restore ruling): two
// small pure functions the PAGES call on what readPlanBoard returns, for
// the minutes pill and the "<N> of your <M> min a day" sum. They read one
// field inside an item's text, not the plan's structure — readPlanBoard
// itself, parsePlanTodo and the plan card all stay exactly as § 6.2/§ 18
// already had them.
//
// @ts-expect-error - plain .mjs, no type declarations (script-runner.ts's
// own posture for a skills/*/scripts/lib import; PR #24, the js-only J2
// switch, moved this out of packages/checkers/src).
import { waitingRows } from "../../../skills/coach/scripts/lib/check-closeout.mjs";
// @ts-expect-error - plain .mjs, no type declarations
import { pySplitlines, restoreLineSeparators, universalNewlines } from "../../../skills/profile/scripts/lib/py-text.mjs";

export interface PlanBoardItem {
  text: string;
  ref?: string;
}

export type PlanBoardLabel = "Waiting on you" | "To do" | "Doing" | "Done";

export interface PlanBoardSection {
  label: PlanBoardLabel;
  items: PlanBoardItem[];
  /** Non-blank lines this reader couldn't turn into an item, as written
   *  (design-web-ui.md § 5.2 rule 6: "unreadable is loud"). */
  unreadable: string[];
}

export interface PlanBoard {
  /** The first line starting "Goal:", word for word, before the first
   *  "## " heading. */
  goalLine?: string;
  /** The first line starting "Budget:", word for word, before the first
   *  "## " heading. */
  budgetLine?: string;
  /** Only the labels actually found, in file order. */
  sections: PlanBoardSection[];
}

const LABELS: PlanBoardLabel[] = ["Waiting on you", "To do", "Doing", "Done"];

/** The first backticked span in `text` that looks like a workspace path
 *  (contains "/" or ends in a file extension) — not just the first
 *  backticked span (a line can quote a non-path word first, e.g. "keep").
 *  § 6.2's own rule; the one copy both readPlanBoard and parsePlanTodo
 *  use. */
function firstPathRef(text: string): string | undefined {
  const re = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const candidate = m[1];
    if (candidate.includes("/") || /\.[A-Za-z0-9]+$/.test(candidate)) return candidate;
  }
  return undefined;
}

function withRef(text: string): PlanBoardItem {
  const ref = firstPathRef(text);
  return ref ? { text, ref } : { text };
}

/** A board label: case-sensitive, must start the line (column 0), followed
 *  by a word boundary — "To do (2)" and "To do:" are labels, "  To do"
 *  (indented) and "to do" (lower case) are not (§ 18's own behaviour-change
 *  table). */
function labelAt(line: string): PlanBoardLabel | undefined {
  for (const label of LABELS) {
    if (!line.startsWith(label)) continue;
    const rest = line.slice(label.length);
    if (rest === "" || !/^[A-Za-z0-9_]/.test(rest)) return label;
  }
  return undefined;
}

const BULLET_RE = /^\s*(?:\d+\.|[-*•])\s+(.*)$/;

/** The grammar the "To do"/"Doing"/"Done" sections share with
 *  `waitingRows` (§ 18): a bullet (now also an indented one, or numbered,
 *  or "• ") starts an item; a later non-blank, non-bullet line joins the
 *  item above as a continuation (never ends the section); a non-blank,
 *  non-bullet line BEFORE the first item is unreadable, and parsing keeps
 *  going past it (later items still read). Blank lines are skipped. */
function parseSectionBody(bodyText: string): { items: PlanBoardItem[]; unreadable: string[] } {
  const pieceLists: string[][] = [];
  const unreadable: string[] = [];
  let cur: string[] | null = null;
  for (const line of pySplitlines(bodyText)) {
    if (line.trim() === "") continue;
    const m = line.match(BULLET_RE);
    if (m) {
      cur = [m[1]];
      pieceLists.push(cur);
    } else if (cur) {
      cur.push(line.trim());
    } else {
      unreadable.push(restoreLineSeparators(line));
    }
  }
  const items = pieceLists.map((pieces) => withRef(restoreLineSeparators(pieces.join(" "))));
  return { items, unreadable };
}

export function readPlanBoard(md: string): PlanBoard {
  const text: string = universalNewlines(md);
  const lines = text.split("\n");

  // Head lines (schema.md: "An optional H1 title, then two head lines"),
  // looked for only before the first "## " heading.
  let goalLine: string | undefined;
  let budgetLine: string | undefined;
  for (const line of lines) {
    if (line.startsWith("##")) break;
    if (goalLine === undefined && line.startsWith("Goal:")) goalLine = restoreLineSeparators(line);
    if (budgetLine === undefined && line.startsWith("Budget:")) budgetLine = restoreLineSeparators(line);
  }

  // The first occurrence of each label, in file order.
  const found: Array<{ label: PlanBoardLabel; index: number }> = [];
  const seenLabels = new Set<PlanBoardLabel>();
  lines.forEach((line, index) => {
    const label = labelAt(line);
    if (label && !seenLabels.has(label)) {
      seenLabels.add(label);
      found.push({ label, index });
    }
  });
  found.sort((a, b) => a.index - b.index);

  const sections: PlanBoardSection[] = found.map(({ label, index }, i) => {
    const nextLabelIndex = found[i + 1]?.index ?? lines.length;
    let end = nextLabelIndex;
    for (let j = index + 1; j < nextLabelIndex; j++) {
      if (lines[j].startsWith("#")) {
        end = j;
        break;
      }
    }
    const bodyLines = lines.slice(index + 1, end);

    if (label === "Waiting on you") {
      // waitingRows finds this block itself (its own regex requires the
      // label line to be exactly "Waiting on you", so a form it rejects —
      // "Waiting on you (1)" — falls through to the unreadable branch
      // below, per § 18).
      const rows = waitingRows(text) as string[];
      const items = rows.map((r) => withRef(restoreLineSeparators(r)));
      const hasNonBlank = bodyLines.some((l) => l.trim() !== "");
      const unreadable =
        items.length === 0 && hasNonBlank
          ? bodyLines.filter((l) => l.trim() !== "").map((l) => restoreLineSeparators(l))
          : [];
      return { label, items, unreadable };
    }
    const { items, unreadable } = parseSectionBody(bodyLines.join("\n"));
    return { label, items, unreadable };
  });

  return { goalLine, budgetLine, sections };
}

// ---------------------------------------------------------------------
// splitPlanMinutes / budgetMinutesPerDay — § 18.1.
// ---------------------------------------------------------------------

const MINUTES_RE = / — ([1-9]\d{0,2}) min(?= — |$)/g;

export interface PlanMinutes {
  action: string;
  minutes: number;
  why?: string;
}

export function splitPlanMinutes(text: string): PlanMinutes | undefined {
  const matches = [...text.matchAll(MINUTES_RE)];
  if (matches.length !== 1) return undefined;
  const m = matches[0];
  const action = text.slice(0, m.index);
  if (action.trim() === "") return undefined;
  const minutes = Number(m[1]);
  const rest = text.slice((m.index ?? 0) + m[0].length);
  const why = rest === "" ? undefined : rest.slice(3); // rest is "" or " — <why>"
  return why === undefined ? { action, minutes } : { action, minutes, why };
}

const BUDGET_RE = /^Budget:\s*([1-9]\d{0,3})\s*min\/day\b/;

export function budgetMinutesPerDay(budgetLine: string | undefined): number | undefined {
  if (budgetLine === undefined) return undefined;
  const m = budgetLine.match(BUDGET_RE);
  return m ? Number(m[1]) : undefined;
}
