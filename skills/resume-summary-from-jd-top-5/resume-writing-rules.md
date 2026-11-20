# Resume and application writing rules

A practical guide for a tailored resume, a required cover letter, and application answers. It is written for any job seeker. Examples are generic and made up. They are not approved claims.

The job description chooses which evidence to use. It is not an outline the reader has to reconstruct. Every public sentence has to make sense to someone who has not seen the job description and does not already know the background.

How this fits the kit:

- Summary procedure: [SKILL.md](SKILL.md) in this folder. Follow that process when writing the summary.
- Review standard: [apply-rubric.md](../../workspace/job-apps/rework/apply-rubric.md).
- Cover template, when a cover is required: [COVER-FORMAT.md](../../workspace/job-apps/base-resumes/COVER-FORMAT.md).
- Package commands and the submit gate: [the apply skill](../job-search-apply/SKILL.md).
- When [policy.yaml](../../workspace/job-search/profile/policy.yaml) sets `summary_bullets`, `summary_words`, `experience_words`, `max_pages`, `cover_words`, or `cover_bullets`, those values are the limits. The ranges below are the generic defaults for an unconfigured kit.

Use only facts the current user has approved. In this kit those facts live in `claims.yaml`. Do not copy an example below onto a resume.

---

## 1. Summary method

Write the summary as short bullets, not a paragraph of adjectives.

Each bullet is one or two full sentences a stranger can read without the job description. Open with what you built or owned, where, and the result. A plain phrase may name the need first when the sentences after it still stand on their own. Do not print the private requirement map as short labels, and do not force one public bullet per job ask.

Example (made up, not an approved claim):

- I built a customer-facing solutions team as a field lead and later led an engineering organization. Earlier I built professional services teams in regional markets.

Rules:

- Privately map the job's top 3-5 requirements to the strongest approved proof. Keep that mapping in preparation notes. Do not print it on the resume as labels the reader must decode.
- Change which proof you lead with for each role so the summary matches that job's top needs. Keep the proof as facts you can defend.
- One claim per bullet. Do not repeat the same story in two bullets. Group related proof together.
- Order the bullets by importance for this role. Strongest first.
- With no `summary_bullets` range set, use a short list, usually 3-4 evidence bullets, plus a logistics line at the end when you include one. Do not add another bullet that repeats a story already told. Stay concise. A good bullet is two lines, not a paragraph.
- Names and numbers can stand on their own when a reader will recognize them. Add a short gloss only for something unguessable (example: "a scheduling agent checked by model graders"). Do not add long explanations of well-known companies or products.
- If you use an internal project or product name, say what it is in a few words before you lean on the name.
- Concrete stories beat generic adjectives. "When a security review blocked a partnership, we rebuilt the product to run inside the partner's cloud and cleared the review" is stronger than "experienced in security and compliance."
- If you add a custom bullet for a gap the rest of the summary does not cover, put it after the evergreen bullets and before the logistics line. One or two custom bullets is enough.
- A location or work-authorization line belongs at the end. It is not evidence of fit. Mention work authorization only once on the resume, not again on the cover letter.

### Readability check

Read the finished summary without the job description. A stranger should be able to say what you do, what you owned, and what improved. Then check the summary against the private requirement-to-proof map and make sure every top reason you are a fit is still high and plain. If something important is missing, improve the story or move proof into the experience section. Do not add another label or an overlapping bullet to paper over a gap.

The most important review question: does this resume highlight all the reasons you are the best candidate for this job?

---

## 2. Stake-first stories

When a bullet is a story, open with the bigger-picture stake, then what you did, then the result. Lead with why it mattered, not with the action.

Example (made up):

- A partner's security review blocked the launch. We rebuilt the product to run inside their cloud, opened the code for their vendors to inspect, and cleared the review.

"The launch was blocked" tells the reader why the next sentence matters. Leading with "I rebuilt the product..." makes them read the whole bullet before they know what was at risk. This is the same order a good interview story follows: situation, action, result.

On the summary, keep that order inside full sentences. Do not reduce the stake to a bare label.

---

## 3. Resume structure and formatting

Use a clean, ATS-friendly layout, reverse chronological, current role first.

Suggested section order: headline and contact, SUMMARY, PROFESSIONAL EXPERIENCE, selected work or publications (if you have them), EDUCATION, SKILLS at the very end. The format gate checks this order.

Formatting:

- Keep the resume under two pages, or under `max_pages` when that is set.
- Use short bullets, not long paragraphs. With no word cap set, keep a summary bullet near 50 words and an experience bullet near 40 words. Configured `summary_words` and `experience_words` replace those defaults.
- Do not use arrow symbols, em-dashes as decorative dashes, or emoji in the resume or cover letter. Prefer commas in headers ("Company, Title" and "Degree, School").
- Put Skills last, as a short line of nouns, so applicant-tracking systems can parse them without crowding the top of the resume.
- Put the target title in the headline or summary. Never invent a job title you did not hold.
- A short tagline under the name can position you in plain language. Do not repeat metrics that already appear in the summary or experience.
- Keep titles, dates, and employer names congruent with the public profile.
- Avoid typography and hidden text that look generated. Do not leave internal notes, TODOs, or reviewer comments in anything you submit.

Age signals and privacy:

- Do not advertise career length on the resume ("20+ years," "decades," "seasoned," "veteran"). Let dates and stories do that work.
- If you want a shorter date window, fold earlier roles into one undated "Earlier career" line rather than stretching the resume with old dates.
- Leave graduation years off if they create an unhelpful age signal, and whenever `hide_graduation_years` is set.
- Do not put a street address on the resume or cover letter. City and region are enough. Save the street address for forms that ask for it.

---

## 4. Cover letters

Write a cover letter only when the application form requires one. If it is optional or absent, skip it and do not upload one. The structure, when one is required, is [COVER-FORMAT.md](../../workspace/job-apps/base-resumes/COVER-FORMAT.md).

Keep it near `cover_words` when that is set, otherwise about 150 words:

1. `Dear <Company> Hiring Team,`
2. One sentence on why you fit this role. No generic praise of the company or industry.
3. Proof bullets, using `cover_bullets` when that is set, otherwise 3-4. Each starts with a **bold few-word label** for one of the job's top needs, then one or two sentences of named proof (employer and outcome). Bold labels belong on a required cover, not on the resume summary.
4. One closing line (for example, "I'd welcome the chance to discuss how I'd approach X.").
5. The approved name and a single approved contact line.

Do not repeat the work-authorization line on the cover. Do not recite the posted salary range.

If you are writing a short outreach note about an application, open with "I'm applying for [role]" so the reader has context, the same way the cover letter does.

---

## 5. Claim discipline

Use only facts you can verify: titles, dates, team sizes, metrics, technologies, and employers you actually had. If you cannot defend a number in an interview, leave it off. A new claim is written into `claims.yaml` and approved before it appears on a resume.

Distinguish adjacent experience from direct experience. If you have close but not identical work, say what you actually did, in plain candidate voice. Do not imply that earlier infrastructure work was AI work, or that related tooling was a platform you never built.

Do not add defensive disclaimers such as "I do not claim X" or "this was not LLM or security work." Describe the real work positively and precisely, and let an honest gap stay a gap.

Do not:

- Invent a title, metric, technology, or employer to fill a gap.
- Echo a phrase from the job description as if it were your experience.
- Paraphrase a true claim into a stronger one (for example, turning "log event capture" into "a Kafka streaming platform," or turning "deployments got shorter" into "I cut sales cycles").
- Use a product or project name in a way that credits it to the wrong employer.
- Overstate scale.
- Claim a public API, integration, or capability that only exists locally or internally, unless you say so plainly.

When a requirement is a stretch, either show the closest honest proof, leave it out, or flag it as a blocker. Never invent a fact to make a blocker disappear.

---

## 6. Application answers

Decide standing answers in advance so you do not improvise under time pressure. Record them with the current user. Do not invent a standing answer in the draft.

- Worked here before: Yes only if that company is actually on the resume. Otherwise No.
- Years of experience: pick a consistent band that matches the history without advertising age. Do not inflate, and do not use a number that functions as a birth-year hint.
- Compensation: if the job posts a range and you are open inside it, "Open within the posted range" is clearer than inventing a single number. Know the floor, and do not automatically type the floor into a desired-salary field.
- Work authorization and sponsorship: answer truthfully and consistently with the line on the resume.
- Voluntary EEO questions: you may decline them when the form allows it. If a required field has no decline option, use a truthful standing answer already decided.
- Do not guess. If you do not have a standing answer, pause and decide before you submit.
- Use one consistent email and phone on the resume and the form. Take both from the approved profile. Do not type a contact line from memory.

---

## 7. Quality gate before you submit

A careful application is researched, checked, and reviewed before it goes out. The apply skill runs the commands. This is the checklist those commands are for.

- Capture the job description (with the URL and the date you captured it) and write a short, sourced note on what the company does.
- Lint the resume for structure and formatting: required sections, length, typography, leaked notes, and wordy bullets.
- Check every number and named claim against approved facts.
- Review the package from more than one angle: would a hiring manager see proof of the job's top outcomes; would a recruiter understand the story in a few seconds without the job description; would an applicant-tracking system find the important terms; is every claim true?
- Ask whether the resume highlights all the reasons you are the best candidate, and name the most likely screen-out reason. If you cannot fix a hard gap honestly, do not invent your way around it.
- Submit only after those checks pass and the current user has named the roles and said go. Mark the job as submitted only after a confirmation screen or email.

Write a cover letter only when the form requires one. Upload only the files the submit gate prints.
