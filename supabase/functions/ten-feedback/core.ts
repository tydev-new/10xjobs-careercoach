// The pure part of ten-feedback (docs/design-feedback.md § 9.2 step 3): the
// shape of the one body it accepts. No Deno/Edge-Runtime global and no
// network. The function checks SHAPES, not the skill list, so that list lives
// in one place (skills/feedback/scripts/lib/feedback.mjs); every rule below
// is also a check on public.ten_feedback, so a body that passes here cannot
// make the table refuse it (a refusal there would be a bug, answered as a
// failure).

/** § 9.2 step 2: the most bytes a request body may hold. */
export const MAX_BODY_BYTES = 8192;

export const KEYS = [
  "kind",
  "comment",
  "rating",
  "skill",
  "step",
  "version",
  "host",
  "installationId",
] as const;

/** The arguments of `rpc/ten_feedback_add`, taken only from a validated body. */
export interface FeedbackArgs {
  p_kind: "bug" | "comment";
  p_comment: string;
  p_rating: number | null;
  p_skill: string;
  p_step: string;
  p_version: string;
  p_host: "local" | "web";
  p_installation_id: string | null;
}

export type Validated = { ok: true; args: FeedbackArgs } | { ok: false };

/** Length in characters as Postgres counts them (code points), not UTF-16 units. */
function cpLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** A string the database can hold: no NUL, and no lone surrogate (which
 * JSON would carry as an escape that Postgres refuses). */
function storable(s: string): boolean {
  if (s.includes("\u0000")) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** § 9.2 step 3 + § 10.1: exactly the eight keys, each passing its rule. */
export function validateBody(body: unknown): Validated {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false };
  const o = body as Record<string, unknown>;
  const own = Object.keys(o);
  if (own.length !== KEYS.length || !KEYS.every((k) => Object.prototype.hasOwnProperty.call(o, k))) {
    return { ok: false };
  }

  const { kind, comment, rating, skill, step, version, host, installationId } = o;

  if (kind !== "bug" && kind !== "comment") return { ok: false };
  if (typeof comment !== "string" || !storable(comment) || cpLength(comment) > 2000) return { ok: false };
  if (rating !== null && !(typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
    return { ok: false };
  }
  if (typeof skill !== "string" || !(skill === "" || /^[a-z][a-z-]{0,29}$/.test(skill))) return { ok: false };
  if (typeof step !== "string" || !storable(step) || cpLength(step) > 60 || /[@/\\\r\n]/.test(step)) {
    return { ok: false };
  }
  if (typeof version !== "string" || !/^[0-9A-Za-z.+-]{1,40}$/.test(version)) return { ok: false };
  if (host !== "local" && host !== "web") return { ok: false };
  if (installationId !== null && !(typeof installationId === "string" && /^[0-9a-f]{32}$/.test(installationId))) {
    return { ok: false };
  }

  // The table's own checks across fields.
  if (comment === "" && rating === null) return { ok: false };
  if (kind === "bug" && comment === "") return { ok: false };

  return {
    ok: true,
    args: {
      p_kind: kind,
      p_comment: comment,
      p_rating: rating as number | null,
      p_skill: skill,
      p_step: step,
      p_version: version,
      p_host: host,
      p_installation_id: installationId as string | null,
    },
  };
}
