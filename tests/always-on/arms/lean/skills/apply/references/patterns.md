# Apply — the craft that binds

Assembly, the tailoring sequence, cover-letter and answer-drafting
technique, and the persona panel are the model's own judgment. This
file holds only the parts a script enforces or a promise to the
candidate binds. Rules live in `../SKILL.md`; the standard in
`eval.md`; file shapes in `schema.md`.

### Shape

One piece of the résumé's shape is enforced, not judgment: **`##
Summary` is the single opening section** — never stack a narrative
summary paragraph AND a bulleted "Core Expertise" list; choose one.
`scripts/check_materials.py` FAILs a second opening section.

## Assembly

One rule here is enforced: **experience bullets are the base's own
sentences** — selection, order, and depth ARE the tailoring.
`scripts/check_materials.py --base` FAILs a non-verbatim bullet.

## Rewording for the JD's vocabulary

Verbatim selection is the default. A bullet may be reworded into the
posting's words only when the candidate approves it, under four rules:
same facts, same numbers, **same scope** (no noun the base does not
carry), the verb ceiling holds ("prototyped" never becomes "shipped"),
vaguer is allowed, stronger never. Each rewording is declared in the
file's `## Reworded` block as `base → tailored`, approved line by
line — the guarantee is not "nothing is reworded" but "nothing is
reworded off the record."

## The PDF — ATS-safe rendering

`scripts/render_resume.py` owns the markup, the escaping, and the
measurement — never hand-roll HTML at delivery. Template contract:
single column; no tables, text boxes, images, icons, headers/footers;
standard fonts only, never embedded font files; plain `•` bullets; real
selectable text.

**Conversion ladder** (the script's fallback story): a platform tool
that renders HTML → PDF · headless Chrome (`--headless --disable-gpu
--print-to-pdf`) · `weasyprint`/`reportlab` if installed · the honest
fallback — open the HTML and ask the candidate to print-to-PDF.

**Verify before delivering, every time**: text extracts back with a
REAL extractor (`pdftotext` / `pypdf` — never stream-grep); numbers and
names match the `.md` exactly; page count measured against the target;
file size under ~100KB.

## The live form — browser mechanics

Field-walking and the attachment ladder are judgment calls. Two things
here are not:

- **Compensation:** a stated strategy if the candidate has one,
  otherwise the field-appropriate non-answer (blank / "flexible" /
  range only if forced) and ask. Salary HISTORY is a different field,
  banned in 21+ states — say so, point at a lookup for their state,
  leave it blank pending their call; you are not their lawyer.
- **Failure honesty:** CAPTCHA → hand to the candidate. Form
  rejects/timeouts → report exactly what happened and the state the
  form was left in. An ATS that blocks automation → say so.

## The cover letter, the persona panel, application answers

Craft — the model's own judgment.
