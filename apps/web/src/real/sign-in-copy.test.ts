// design-web-ui.md § 1.4 (amended 2026-10-07, C29): the sign-in card's words
// equal their § 5.3.1 rows, word for word. The rows are READ from the doc, so
// the table is the one source and a drift on either side fails this file.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SIGN_IN_INVALID_CREDENTIALS_LINE, SIGN_IN_UNCONFIRMED_LINE } from "../backend/auth.ts";
import {
  BACK_TO_SIGN_IN,
  CREATE_ACCOUNT_BUTTON,
  EMAIL_LABEL,
  EXPIRED_LINK_LINE,
  FORGOT_LINK,
  PASSWORD_LABEL,
  SIGN_IN_BUTTON,
  SWITCH_TO_CREATE,
  SWITCH_TO_SIGN_IN,
  signUpSentLine,
} from "./sign-in-copy.ts";

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

test("Y4-Y9, Y20, Y24, Y27: the card's lines equal their rows", () => {
  assert.equal(EMAIL_LABEL, row("Y4"));
  assert.equal(PASSWORD_LABEL, row("Y5"));
  assert.equal(SIGN_IN_BUTTON, row("Y6"));
  assert.equal(CREATE_ACCOUNT_BUTTON, row("Y7"));
  assert.equal(SWITCH_TO_CREATE, row("Y8"));
  assert.equal(SWITCH_TO_SIGN_IN, row("Y9"));
  assert.equal(FORGOT_LINK, row("Y20"));
  assert.equal(BACK_TO_SIGN_IN, row("Y24"));
  assert.equal(EXPIRED_LINK_LINE, row("Y27"));
});

test("Y11: the typed address fills the placeholder, the rest word for word", () => {
  assert.equal(signUpSentLine("a@example.com"), row("Y11").replace("<email>", "a@example.com"));
  assert.match(signUpSentLine("a@example.com"), /^Check a@example\.com for a link to confirm your account\./);
});

test("Y12 and Y13: the two sign-in errors equal their rows", () => {
  assert.equal(SIGN_IN_INVALID_CREDENTIALS_LINE, row("Y12"));
  assert.equal(SIGN_IN_UNCONFIRMED_LINE, row("Y13"));
});

test("the retired lines are gone: no constant carries a way in that was removed (C29)", () => {
  const all = [
    EMAIL_LABEL, PASSWORD_LABEL, SIGN_IN_BUTTON, CREATE_ACCOUNT_BUTTON, SWITCH_TO_CREATE, SWITCH_TO_SIGN_IN,
    FORGOT_LINK, BACK_TO_SIGN_IN, EXPIRED_LINK_LINE, signUpSentLine("a@example.com"),
    SIGN_IN_INVALID_CREDENTIALS_LINE, SIGN_IN_UNCONFIRMED_LINE,
  ].join("\n");
  for (const gone of ["email link", "send me a link", "sign-in link", "Ask for a new one below", "use a password instead"])
    assert.ok(!all.toLowerCase().includes(gone.toLowerCase()), gone);
});
