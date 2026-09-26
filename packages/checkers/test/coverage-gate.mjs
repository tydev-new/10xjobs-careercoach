#!/usr/bin/env node
// The § 5 coverage gate (fix round 1, item 12): fails loudly if any
// `def test_` in the matching tests/test_*.py files isn't named by an
// entry in the MANIFEST below — every entry is either a `test/parity.mjs`
// case id (grep'd for at runtime, so it can't silently go stale), a
// `test/unit/*.test.mjs` test title (same), or an explicit "N/A: <why>"
// for the couple of Python tests that check something about the PYTHON
// FILE ITSELF (introspection) rather than the checker's runtime
// behavior — there is no JS equivalent artifact to point a parity case
// at. See README.md "Coverage map" for the prose version of this table.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");
const REPO_ROOT = join(PKG, "..", "..");
const TESTS_DIR = join(REPO_ROOT, "tests");

const PY_FILES = [
  "test_check_materials.py",
  "test_check_files.py",
  "test_proposal_block.py",
  "test_render_resume.py",
  "test_jobs_md.py",
  "test_check_closeout.py",
  // design-web-agent.md § 5: "every `def test_` ... plus test_e2e_lifecycle
  // (the one that runs record_verdict/update_job)" — fix round 2, item 3.
  "test_e2e_lifecycle.py",
];

// name -> { parity: "<case id substring>" } | { unit: "<test title substring>", file: "<test/unit file>" } | { na: "<reason>" }
const MANIFEST = {
  // ---- test_check_materials.py
  test_mechanical_cases: { parity: "test_mechanical_cases" }, // + every other check_materials parity case; also unit-tested directly
  test_language_parsers_deleted_and_contract_exists: {
    na: "asserts specific Python functions (load_hazards/load_never_say/quoted_phrases) were DELETED from the Python module, and that profile/references/language-check.md carries the migration — a fact about the Python file and a prose doc, not the checker's runtime behavior. This port never had those functions in the first place (see src/check-materials.mjs's history comment).",
  },
  test_declared_rewording_is_exempt: { parity: "rewording-declared-exempt" },
  test_undeclared_rewording_still_fails: { parity: "rewording-undeclared-fails" },
  test_reworded_block_cannot_self_issue_its_exemption: { parity: "rewording-cannot-self-issue" },
  // ---- owner ruling 6 (2026-09-25, docs/design-apply-three-lens.md § 4): ASCII arrow chains
  test_ascii_arrow_chain_fails_each_form: { parity: "ascii-arrow-form-arrow" }, // + 6 other arrow-form cases
  test_ascii_arrow_exempt_spans_pass: { parity: "ascii-arrow-exempt-url" }, // + exempt-inline-code, exempt-fence, exempt-comment
  test_ascii_le_ge_do_not_fail: { parity: "ascii-le-ge-no-finding" },
  test_bullets_only_summary_passes_case_budget: { parity: "bullets-only-summary-passes-case-budget" },

  // ---- test_check_files.py (unit titles are check-files.test.mjs, in the same order as the Python file)
  test_conforming_profile_passes: { unit: "a conforming profile.md passes", file: "check-files.test.mjs" },
  test_missing_required_section_fails: { unit: "a missing required section FAILs", file: "check-files.test.mjs" },
  test_foreign_section_fails_with_its_owner_named: { unit: "a foreign section FAILs with its owner named", file: "check-files.test.mjs" },
  test_unknown_section_only_warns: { unit: "an unknown section only WARNs", file: "check-files.test.mjs" },
  test_escape_hatch_contents_are_not_policed: { unit: "the escape hatch's contents are not policed", file: "check-files.test.mjs" },
  test_singular_plural_folds: { unit: "singular/plural folds", file: "check-files.test.mjs" },
  test_absent_file_is_not_an_error: { unit: "an absent file is not an error", file: "check-files.test.mjs" },
  test_prose_mention_in_another_skill_cannot_clobber_a_schema: { unit: "a prose mention in another skill cannot clobber a schema", file: "check-files.test.mjs" },
  test_storybank_schema_registered_and_enforced: { unit: "storybank.md schema is registered and enforced", file: "check-files.test.mjs" },
  test_pitch_schema_registered: { unit: "pitch.md schema is registered with the right required sections", file: "check-files.test.mjs" },
  test_knowledge_schema_registered: { unit: "knowledge.md schema is registered", file: "check-files.test.mjs" },
  test_brief_schemas_registered: { unit: "brief schemas are registered with FIXED", file: "check-files.test.mjs" },
  test_brief_missing_living_fails: { unit: "a brief missing LIVING FAILs", file: "check-files.test.mjs" },
  test_history_header_enforced: { unit: "history header is enforced", file: "check-files.test.mjs" },
  test_heading_form_schema_declaration_parses: { unit: "the heading-form schema declaration parses", file: "check-files.test.mjs" },
  test_storybank_history_uses_its_own_header: { unit: "storybank-history.md uses its own header", file: "check-files.test.mjs" },
  test_history_header_sync_with_skill_prose: { unit: "history headers stay in sync with the owning skill's own prose", file: "check-files.test.mjs" },
  test_stray_file_and_dir_warn_but_never_fail: { unit: "a stray file/dir WARNs but never FAILs", file: "check-files.test.mjs" },
  test_manifest_and_schema_files_are_not_strays: { unit: "manifest and schema files are not strays", file: "check-files.test.mjs" },
  test_candidate_history_file_is_not_policed: { unit: "a candidate's own *-history.md is not policed", file: "check-files.test.mjs" },
  test_escaped_pipe_in_history_cell_is_text_not_boundary: { unit: "an escaped pipe in a history cell is text", file: "check-files.test.mjs" },
  test_coverage_enums_enforced_but_never_block: { unit: "coverage enums are enforced but never block", file: "check-files.test.mjs" },
  test_valid_coverage_table_is_silent: { unit: "a valid coverage table is silent", file: "check-files.test.mjs" },
  test_selection_table_enums_and_cell_count: { unit: "selection table enums and cell count", file: "check-files.test.mjs" },
  test_absent_table_is_silent: { unit: "an absent table is silent", file: "check-files.test.mjs" },
  test_a_realistic_multi_table_application_is_silent: { unit: "a realistic multi-table application is silent", file: "check-files.test.mjs" },
  test_broken_relative_link_fails: { unit: "a broken relative link FAILs", file: "check-files.test.mjs" },
  test_correct_relative_link_is_silent: { unit: "a correct relative link is silent", file: "check-files.test.mjs" },
  test_cross_skill_link_without_dotdot_fails: { unit: "a cross-skill link without ./ or ../ is now MATCHED", file: "check-files.test.mjs" },
  test_skill_root_relative_link_is_silent: { unit: "a skill-root-relative link", file: "check-files.test.mjs" },
  test_schema_placeholder_is_not_a_link: { unit: "a schema placeholder (<slug>) is not treated as a link", file: "check-files.test.mjs" },
  test_link_escaping_the_skill_tree_fails: { unit: "a link that escapes the skill tree FAILs", file: "check-files.test.mjs" },
  test_orphan_table_cell_warns: { unit: "an orphan table cell WARNs, never FAILs", file: "check-files.test.mjs" },
  test_section_pointers_are_deliberately_not_checked: { unit: "§-section pointers are deliberately not checked", file: "check-files.test.mjs" },
  test_inlined_rounds_table_enforced: { parity: "inlined-rounds-table" },

  // ---- test_proposal_block.py
  test_prints_the_cut_list_short_with_why: { parity: "prints-cut-list" },
  test_have_row_missing_their_word_warns_and_near_vocab_does_not: { parity: "prints-cut-list" },
  test_out_rows_in_base_order_warns: { parity: "prints-cut-list" },
  test_out_row_without_why_fails: { parity: "out-row-without-why-fails" },
  test_missing_table_fails: { parity: "missing-table-fails" },

  // ---- test_render_resume.py
  test_wrapped_prose_is_one_paragraph: { unit: "wrapped prose is one paragraph", file: "render-resume.test.mjs" },
  test_bold_spanning_a_line_break_converts: { unit: "bold spanning a line break converts", file: "render-resume.test.mjs" },
  test_html_is_escaped_by_the_builder: { unit: "HTML is escaped by the builder", file: "render-resume.test.mjs" },
  test_bullets_group_into_one_list: { unit: "bullets group into one list", file: "render-resume.test.mjs" },
  test_word_count_ignores_markup: { unit: "word count ignores markup", file: "render-resume.test.mjs" },
  test_page_target_is_reported_not_enforced_by_default: {
    na: "asserts (via inspect.getsource) that specific STRINGS appear in the Python main()'s source code (\"never trim silently\", the literal token '\"--strict\"') — a fact about the Python file's text, not the checker's runtime behavior. This port's render-resume.mjs never implements page-count enforcement at all (see its own header comment on the --pdf divergence), so the property the Python test guards can't regress here by construction.",
  },

  // ---- test_jobs_md.py
  test_roundtrip_preserves_everything: { unit: "roundtrip preserves everything", file: "jobs-md.test.mjs" },
  test_duplicate_key_is_a_hard_error: { unit: "duplicate key is a hard error", file: "jobs-md.test.mjs" },
  test_find_exact_beats_substring: { unit: "find: exact beats substring", file: "jobs-md.test.mjs" },
  test_find_ambiguous_returns_all: { unit: "find: ambiguous returns all", file: "jobs-md.test.mjs" },
  test_stage_sections_render_in_board_order: { unit: "stage sections render in board order", file: "jobs-md.test.mjs" },
  test_notes_survive_saves_and_never_parse_as_roles: { unit: "notes survive saves and never parse as roles", file: "jobs-md.test.mjs" },

  // ---- test_check_closeout.py
  test_clean: { parity: "test_clean" },

  // ---- test_e2e_lifecycle.py (design-web-agent.md § 5's own name for this file)
  test_full_candidate_lifecycle_e2e: { parity: "e2e-stage5-writer-application" }, // also covers "creates-new-role" (record_verdict) — the record_verdict/update_job runs § 5 calls out by name
  test_e2e_pitch_and_linkedin_in_profile: {
    na: "its own ported-checker call (check_files.py --workspace . --skills SKILLS) exercises the SAME check_files logic the dedicated check_files corpus (35 unit cases, 19 parity cases) already covers byte-for-byte — this test's distinguishing content (pitch/LinkedIn-audit prose, profile intake) has no unported behavior of its own; the checker call inside it is not a NEW code path.",
  },
  test_e2e_interview_prep_mock_and_debrief_writes: {
    na: "calls check_stories.py and check_knowledge.py (both explicitly out of § 5's port list — see README.md \"Not done\") alongside check_files.py, whose logic is already covered as above; nothing here exercises a ported checker's behavior this file doesn't already prove elsewhere.",
  },
  test_bad_stage_fails: { parity: "bad_stage_fails" },
  test_question_without_row_fails: { parity: "question_without_row_fails" },
  test_stale_plan_fails: { parity: "stale_plan_fails" },
  test_missing_plan_fails: { parity: "missing_plan_fails" },
  test_stage_auto_inferred: { parity: "stage_auto_inferred" },
};

function extractTestNames(pyFile) {
  const text = readFileSync(join(TESTS_DIR, pyFile), "utf-8");
  return [...text.matchAll(/^def (test_\w+)\(/gm)].map((m) => m[1]);
}

const parityText = readFileSync(join(PKG, "test", "parity.mjs"), "utf-8");
const unitDir = join(PKG, "test", "unit");
const unitTexts = {};
for (const f of readdirSync(unitDir)) {
  if (f.endsWith(".test.mjs")) unitTexts[f] = readFileSync(join(unitDir, f), "utf-8");
}

let missing = 0;
let unverified = 0;
for (const pyFile of PY_FILES) {
  const names = extractTestNames(pyFile);
  for (const name of names) {
    const entry = MANIFEST[name];
    if (!entry) {
      console.log(`[MISSING] ${pyFile}::${name} — no manifest entry (add one to test/coverage-gate.mjs)`);
      missing++;
      continue;
    }
    if (entry.na) {
      console.log(`[N/A]     ${pyFile}::${name} — ${entry.na.slice(0, 70)}...`);
      continue;
    }
    if (entry.parity) {
      if (!parityText.includes(entry.parity)) {
        console.log(`[STALE]   ${pyFile}::${name} — manifest points at parity.mjs case "${entry.parity}", not found there anymore`);
        unverified++;
      } else {
        console.log(`[OK]      ${pyFile}::${name} -> parity.mjs :: ${entry.parity}`);
      }
    } else if (entry.unit) {
      const text = unitTexts[entry.file];
      if (!text || !text.includes(entry.unit)) {
        console.log(`[STALE]   ${pyFile}::${name} — manifest points at ${entry.file} :: "${entry.unit}", not found there anymore`);
        unverified++;
      } else {
        console.log(`[OK]      ${pyFile}::${name} -> ${entry.file} :: ${entry.unit}`);
      }
    }
  }
}

const total = missing + unverified;
console.log(`\n${total === 0 ? "PASS" : "FAIL"}: ${missing} test(s) with no manifest entry, ${unverified} manifest entr(ies) pointing at a case/title that no longer exists`);
process.exit(total === 0 ? 0 : 1);
