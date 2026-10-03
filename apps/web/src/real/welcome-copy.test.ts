// design-web-agent.md § 20.11 (client unit tests): every new or changed string
// equals its row in design-web-ui.md § 5.3.1, word for word. The rows are READ
// from the doc here, so the table is the one source (rule 12) and a drift on
// either side fails this file.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { NOT_A_MEMBER_LINES, SIGN_IN_INVITATION, welcomeLine } from "./welcome-copy.ts";
import { NOT_SET_UP_MESSAGE } from "../backend/auth.ts";
import { DEEPSEEK_COACH_MODEL } from "../backend/coach-model.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const DOC = readFileSync(path.join(REPO, "docs/design-web-ui.md"), "utf8");

/** The `String` cell of a § 5.3.1 row, without its backticks. */
function row(id: string): string {
  const line = DOC.split("\n").find((l) => l.startsWith(`| ${id} |`));
  assert.ok(line, `no row ${id} in § 5.3.1`);
  const cells = line.replace(/^\| /, "").replace(/ \|$/, "").split(" | ");
  const cell = cells[3];
  assert.ok(cell.startsWith("`") && cell.endsWith("`"), `${id}: the String cell is not one backticked string: ${cell}`);
  return cell.slice(1, -1);
}

test("O1 (the welcome line): the amount is the claim's usd, two decimals, the rest word for word", () => {
  assert.equal(welcomeLine(1), row("O1").replace("$<amount>", "$1.00"));
  assert.equal(welcomeLine(2.5), row("O1").replace("$<amount>", "$2.50"));
  assert.equal(welcomeLine(1), "You have $1.00 of free credit to try Ten. Each reply uses some of it, and your balance at the top shows what's left.");
});

test("O1 names the balance chip, promises no gate, and says no number of replies (C § 20.5)", () => {
  const text = welcomeLine(1);
  assert.match(text, /balance at the top/);
  assert.doesNotMatch(text, /gate|about \d+ repl|\d+ repl/i);
});

test("O2, O3, O4 (the not-a-member lines): word for word", () => {
  assert.equal(NOT_A_MEMBER_LINES.paused, row("O2"));
  assert.equal(NOT_A_MEMBER_LINES.unconfirmed, row("O3"));
  assert.equal(NOT_A_MEMBER_LINES.already_claimed, row("O4"));
});

test("O4's contact is support@10xjobs.co (owner, 2026-10-02)", () => {
  assert.match(NOT_A_MEMBER_LINES.already_claimed, /support@10xjobs\.co/);
});

test("O5 (the sign-in invitation): word for word", () => {
  assert.equal(SIGN_IN_INVITATION, row("O5"));
});

test("O6 (no credit row, outside the sign-in flow): word for word, in the client", () => {
  assert.equal(NOT_SET_UP_MESSAGE, row("O6"));
});

test("the model menu label drops '(testing)' (§ 13.6, amended 2026-10-02)", () => {
  assert.equal(DEEPSEEK_COACH_MODEL.name, "DeepSeek V4.1 Flash");
  assert.doesNotMatch(DEEPSEEK_COACH_MODEL.name, /testing/i);
});

test("no screen line promises what the server didn't send or says 'invite-only' (§ 5.3.1's Removed list)", () => {
  for (const line of [...Object.values(NOT_A_MEMBER_LINES), welcomeLine(1), SIGN_IN_INVITATION, NOT_SET_UP_MESSAGE]) {
    assert.doesNotMatch(line, /invite-only/);
  }
});
