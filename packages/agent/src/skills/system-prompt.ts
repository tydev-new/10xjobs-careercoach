// § 7 — staged loading and the per-turn window.
//
// Tier 0 (always, from the BUNDLE, never the workspace copy) + the host
// note (~80 words) + Tier 1 (the four MVP skills' `description:` lines)
// + the tool descriptions (~350 words, passed in by the caller since they
// live on the tool() definitions, not in this file) make up "the always-on
// block". One SKILL.md is added on activation (§ 7 point 2).
import type { SkillBundle } from "../types.ts";

export const TIER0_PATH = "skills/profile/templates/workspace-CLAUDE.md";
/** The host note's own literal text (fix round 1): the architect landed
 *  it as a bundled, skills-adjacent file rather than a string this
 *  package authors, so the word report counts it like every other
 *  bundled instruction. Loaded via buildAlwaysOnSystemPrompt(bundle),
 *  not read directly — see HOST_NOTE_PATH. */
export const HOST_NOTE_PATH = "skills/profile/templates/web-host-note.md";
export const MVP_SKILLS = ["profile", "evaluate", "apply", "coach"] as const;
export type MvpSkillName = (typeof MVP_SKILLS)[number];

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** Extracts the YAML frontmatter `description:` value from a SKILL.md's
 *  text, word for word (folded onto one line, the way YAML folds an
 *  unquoted scalar that continues past the first line makes no
 *  difference here since these are single-line values). */
export function extractDescription(skillMd: string): string {
  const fmMatch = skillMd.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return "";
  const fm = fmMatch[1];
  const descMatch = fm.match(/^description:\s*(.*)$/m);
  return descMatch ? descMatch[1].trim() : "";
}

export interface Tier1Skill {
  name: MvpSkillName;
  description: string;
}

/** Tier 1: the `description:` lines of profile, evaluate, apply, coach
 *  (§ 7 point 1, "the always-on system prompt"). */
export function buildTier1(bundle: SkillBundle): Tier1Skill[] {
  return MVP_SKILLS.map((name) => {
    const md = bundle[`skills/${name}/SKILL.md`] ?? "";
    return { name, description: extractDescription(md) };
  });
}

export interface SystemPromptResult {
  text: string;
  words: number;
  tier0Words: number;
  hostNoteWords: number;
  tier1Words: number;
}

/**
 * Builds the always-on block: Tier 0 (bundled CLAUDE.md, byte for byte)
 * + the host note + Tier 1 (skill descriptions). Tool descriptions are
 * NOT concatenated in here — the AI SDK sends those as the `tools` field
 * of the request, not the system string — but their word count is
 * measured alongside this block's, per § 7's "the tool descriptions:
 * about 350 words" line item (see wordsPerTurn in loader.ts).
 */
export function buildAlwaysOnSystemPrompt(bundle: SkillBundle): SystemPromptResult {
  const tier0 = bundle[TIER0_PATH] ?? "";
  const hostNote = bundle[HOST_NOTE_PATH] ?? "";
  const tier1 = buildTier1(bundle);
  const tier1Text = tier1
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");

  const text = [
    "# CLAUDE.md (workspace guardrails, bundled — always current, never the workspace's own copy)",
    tier0,
    "",
    hostNote,
    "",
    "# Skills available (say what you need; the matching skill loads)",
    tier1Text,
  ].join("\n");

  return {
    text,
    words: countWords(text),
    tier0Words: countWords(tier0),
    hostNoteWords: countWords(hostNote),
    tier1Words: countWords(tier1Text),
  };
}
