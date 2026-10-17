// The feedback skill's pure core (docs/design-feedback.md § 5 to § 8, § 13):
// the skill list, redaction, the eight-field payload, the plain rendering,
// the fixed lines, and the send. No `node:` import and no window/document/
// localStorage here: this one file is the single copy of the rules for both
// hosts (the local script, skills/feedback/scripts/feedback.mjs, and, at
// stage 2, the web tool), so it runs in Node 18+ and in the browser. Every
// side effect (reading the version, the random id, the network) comes in
// through arguments.
//
// Nothing here reads a workspace file or the conversation. The only text it
// ever sends is the rendering the person saw, built by `renderFeedback` from
// the very object that `sendFeedback` posts.

/** § 8.2: the one production address. `TEN_FEEDBACK_URL` replaces it in
 * tests and in the harness only. */
export const PROD_URL = "https://ivunfotoggdxbjouumdk.supabase.co/functions/v1/ten-feedback";

/** § 6: the ten skill names a report may carry; anything else is sent empty. */
export const SKILLS = Object.freeze([
  "apply", "coach", "evaluate", "feedback", "interview",
  "learn", "outreach", "profile", "search", "storybank",
]);

export const KINDS = Object.freeze(["bug", "comment"]);
export const MAX_COMMENT = 2000;
export const MAX_STEP = 60;
export const SEND_TIMEOUT_MS = 15000;
// A guard on the redaction pass, not a product limit: nobody's note is 20,000
// characters before redaction and 2,000 after.
const MAX_RAW = 20000;

/** § 13, word for word. FB2 is the labels (RENDER_LABELS); FB14 is MARKS. */
export const FB = Object.freeze({
  FB1: "This is everything that would go to the Ten team:",
  FB3: "This goes to the people building Ten, exactly as shown, with nothing else from your files or this conversation. Nothing is sent until you say yes.",
  FB4: "Sent to the Ten team. Thank you.",
  FB5: "Ten isn't taking feedback right now, so nothing went. Try again later, or skip it.",
  FB6: "This couldn't be sent just now, so nothing went. Try again later, or skip it.",
  FB7: "There's nothing to send yet. Add a few words, or a rating from 1 to 5.",
  FB8: "A bug report needs a few words about what happened.",
  FB9: "That's over 2,000 characters. Shorten it and try again.",
  FB10: "A rating is a whole number from 1 to 5.",
  FB11: "This couldn't be matched to what you saw, so nothing went. Ask again if you'd like to send it.",
  FB12: "Send feedback",
  FB13: "Feedback for the Ten team: ",
});

/** FB14. */
export const MARKS = Object.freeze({
  email: "[email removed]",
  phone: "[phone removed]",
  link: "[profile link removed]",
  path: "[folder path removed]",
});

/** FB2 / § 7: the label of each of the eight lines, in payload order. */
export const RENDER_LABELS = Object.freeze({
  kind: "Kind:",
  comment: "Your words:",
  rating: "Rating:",
  skill: "Skill:",
  step: "Step:",
  version: "Ten version:",
  host: "Sent from:",
  installationId: "Random id:",
});

/** The eight keys of § 6, in order. Nothing else is ever sent. */
export const PAYLOAD_KEYS = Object.freeze([
  "kind", "comment", "rating", "skill", "step", "version", "host", "installationId",
]);

// Model-facing lines for a call the model got wrong (a bad flag or kind).
// The person never sees these: they are the script's answer to the agent.
export const USAGE =
  "Usage: node scripts/feedback.mjs [--kind bug|comment] [--comment \"<their words>\"] [--rating 1-5] [--skill <name>] [--step \"<title>\"] [--dry-run]";
export const BAD_KIND = "The kind must be bug or comment.";

// ---------------------------------------------------------------- redaction

// § 8.4. Bounded quantifiers keep every pattern linear on hostile input.
// The home-path shapes are the ones tests/test_invariants.py `PII` lists:
// a macOS or Linux home folder. They are built from parts so this file
// never contains a literal home path itself (that test scans skills/).
const HOME_ROOTS = "(?:\\/" + "Users|\\/" + "home)\\/";
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,63}/g;
const LINK = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9%_-]{1,100}\/?/gi;
const PATH = new RegExp(HOME_ROOTS + "[^\\s\"'`<>]+", "g");
const PHONE = /(?:\+\d{1,3}[-. ]?)?\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g;
const TRAILING = /[.,;:!?)\]}]+$/;

/** Blanks an email address, a phone number, a LinkedIn profile link and a
 * home folder path (FB14). A safety net, not the guard. */
export function redact(text) {
  return String(text)
    .replace(EMAIL, MARKS.email)
    .replace(LINK, MARKS.link)
    .replace(PATH, (m) => MARKS.path + (m.match(TRAILING)?.[0] ?? ""))
    .replace(PHONE, MARKS.phone);
}

// ----------------------------------------------------------------- helpers

/** Length in characters as Postgres counts them (code points), not UTF-16 units. */
export function cpLength(s) {
  let n = 0;
  for (const _ of s) n++; // eslint-disable-line no-unused-vars
  return n;
}

// Control characters other than white space, and lone surrogates: invisible,
// useless in a note, and a database refuses some of them. A loop, not a
// lookbehind pattern, so it runs in older browsers too.
function stripJunk(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    if ((c < 0x20 && !(c >= 9 && c <= 13)) || c === 0x7f) continue;
    out += s[i];
  }
  return out;
}

function refusal(code, message) {
  return { error: { code, message } };
}

function cleanText(raw) {
  if (raw === undefined || raw === null) return "";
  return stripJunk(String(raw)).replace(/\s+/g, " ").trim();
}

function parseRating(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 1 && raw <= 5 ? { ok: true, value: raw } : { ok: false };
  }
  if (typeof raw === "string" && /^[1-5]$/.test(raw.trim())) return { ok: true, value: Number(raw.trim()) };
  return { ok: false };
}

function cleanSkill(raw) {
  if (typeof raw !== "string") return "";
  const s = raw.trim();
  return SKILLS.includes(s) ? s : "";
}

function cleanStep(raw) {
  if (typeof raw !== "string") return "";
  const s = raw.trim();
  if (s === "" || cpLength(s) > MAX_STEP) return "";
  // no @, / or \ (they could carry an address or a path), no line break or
  // other control character
  // eslint-disable-next-line no-control-regex
  if (/[@/\\\u0000-\u001F\u007F\u2028\u2029]/.test(s)) return "";
  return s;
}

function cleanVersion(raw) {
  return typeof raw === "string" && /^[0-9A-Za-z.+-]{1,40}$/.test(raw) ? raw : "unknown";
}

// ----------------------------------------------------------------- the payload

/**
 * § 6: the eight-field payload. `input` is what the model passes
 * ({ kind, comment, rating, skill, step }); `ctx` is what code knows
 * ({ version, host, installationId }), or a function returning it, called
 * only once the input has passed (so a refused call touches nothing, not
 * even the random id file).
 *
 * Returns the payload (exactly the eight keys, in order), or
 * `{ error: { code, message } }` where `message` is the line to give the
 * person (FB7 to FB10), or a model-facing line for an unknown kind.
 */
export function buildFeedback(input, ctx) {
  const inp = input ?? {};
  const rawKind = inp.kind === undefined || inp.kind === null || inp.kind === "" ? "comment" : String(inp.kind).trim();
  if (!KINDS.includes(rawKind)) return refusal("invalid_kind", BAD_KIND);

  const rating = parseRating(inp.rating);
  if (!rating.ok) return refusal("invalid_feedback", FB.FB10);

  const rawComment = inp.comment === undefined || inp.comment === null ? "" : String(inp.comment);
  if (rawComment.length > MAX_RAW) return refusal("invalid_feedback", FB.FB9);
  const comment = redact(cleanText(rawComment)).trim();
  if (cpLength(comment) > MAX_COMMENT) return refusal("invalid_feedback", FB.FB9);

  if (rawKind === "bug" && comment === "") return refusal("invalid_feedback", FB.FB8);
  if (comment === "" && rating.value === null) return refusal("invalid_feedback", FB.FB7);

  const c = (typeof ctx === "function" ? ctx() : ctx) ?? {};
  const host = c.host === "web" ? "web" : "local";
  const installationId =
    host === "local" && typeof c.installationId === "string" && /^[0-9a-f]{32}$/.test(c.installationId)
      ? c.installationId
      : null;

  return {
    kind: rawKind,
    comment,
    rating: rating.value,
    skill: cleanSkill(inp.skill),
    step: cleanStep(inp.step),
    version: cleanVersion(c.version),
    host,
    installationId,
  };
}

/** A fresh random id: 32 lowercase hex characters from the caller's
 * `getRandomValues` (crypto.getRandomValues in a browser or Node). */
export function newInstallationId(getRandomValues) {
  const bytes = getRandomValues(new Uint8Array(16));
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

// ----------------------------------------------------------------- the rendering

const none = (v) => (v === undefined || v === null || v === "" ? "none" : String(v));

/**
 * § 7: what the person sees before anything goes. One line per field, FB1
 * first. The local script prints this and the web gate card shows this; the
 * send posts the same object, so what is shown is what goes. No trailing
 * newline.
 */
export function renderFeedback(payload) {
  const p = payload;
  const lines = [
    FB.FB1,
    `${RENDER_LABELS.kind} ${p.kind === "bug" ? "bug report" : "comment"}`,
    `${RENDER_LABELS.comment} ${none(p.comment)}`,
    `${RENDER_LABELS.rating} ${p.rating === null || p.rating === undefined ? "none" : `${p.rating} of 5`}`,
    `${RENDER_LABELS.skill} ${none(p.skill)}`,
    `${RENDER_LABELS.step} ${none(p.step)}`,
    `${RENDER_LABELS.version} ${none(p.version)}`,
    `${RENDER_LABELS.host} ${p.host === "web" ? "the Ten website" : "your computer"}`,
    `${RENDER_LABELS.installationId} ${
      p.host === "web" || !p.installationId
        ? "none"
        : `${p.installationId} (made once on this computer; not linked to your name or email)`
    }`,
  ];
  return lines.join("\n");
}

// ----------------------------------------------------------------- the send

/**
 * § 8.5: POST the payload, nothing else. Returns "sent" (201), "busy" (429)
 * or "failed" (anything else, a network failure, or the timeout). The
 * server's own text is never read. The request carries a content-type and no
 * Authorization, apikey or cookie header.
 */
export async function sendFeedback(payload, { url = PROD_URL, fetchImpl, timeoutMs = SEND_TIMEOUT_MS, makeSignal } = {}) {
  try {
    const signal = makeSignal ? makeSignal(timeoutMs) : AbortSignal.timeout(timeoutMs);
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    const status = res?.status;
    try {
      await res?.body?.cancel?.();
    } catch {
      // nothing to do: the answer's text is never used
    }
    if (status === 201) return "sent";
    if (status === 429) return "busy";
    return "failed";
  } catch {
    return "failed";
  }
}

const RESULT_LINE = { sent: FB.FB4, busy: FB.FB5, failed: FB.FB6 };

// ----------------------------------------------------------------- the command

const VALUE_FLAGS = new Set(["kind", "comment", "rating", "skill", "step"]);

/** Parses the argument list of § 8.1. Returns { flags, dryRun } or { usage: true }. */
export function parseArgs(argv) {
  const flags = {};
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    const m = /^--([a-z]+)(?:=([\s\S]*))?$/.exec(a);
    if (!m || !VALUE_FLAGS.has(m[1])) return { usage: true };
    if (m[2] !== undefined) {
      flags[m[1]] = m[2];
    } else if (i + 1 < argv.length) {
      flags[m[1]] = argv[++i];
    } else {
      return { usage: true };
    }
  }
  return { flags, dryRun };
}

/**
 * The whole command, without the process around it (§ 8.1).
 *
 * deps: { env, fetchImpl, context(), makeSignal? }
 *   env       the environment variables as an object (TEN_FEEDBACK_URL only)
 *   fetchImpl fetch
 *   context() => { version, installationId }, called only after the input passed
 *
 * Returns { stdout, exitCode }. The line to give the person is always the
 * last line of stdout. Exit 0 = printed (dry run) or sent; 1 = refused input
 * or not sent.
 */
export async function run(argv, deps) {
  const parsed = parseArgs(argv);
  if (parsed.usage) return { stdout: USAGE + "\n", exitCode: 1 };

  const payload = buildFeedback(parsed.flags, () => ({ host: "local", ...deps.context() }));
  if (payload.error) return { stdout: payload.error.message + "\n", exitCode: 1 };

  const shown = renderFeedback(payload);
  if (parsed.dryRun) return { stdout: shown + "\n", exitCode: 0 };

  const url = deps.env?.TEN_FEEDBACK_URL || PROD_URL;
  const result = await sendFeedback(payload, { url, fetchImpl: deps.fetchImpl, makeSignal: deps.makeSignal });
  return { stdout: shown + "\n" + RESULT_LINE[result] + "\n", exitCode: result === "sent" ? 0 : 1 };
}
