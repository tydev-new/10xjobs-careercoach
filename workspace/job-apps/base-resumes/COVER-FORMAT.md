# Cover letter format (generic source template; no imported approval)

Use this structure when the current user selects this cover format. Never open with an unsourced paragraph about the company or industry.

## Structure
1. `Dear <Company> Hiring Team,`
2. ONE opening sentence on why the candidate fits THIS role, grounded only in approved claims (placeholder: "{approved positioning} fits {their mandate} because {approved evidence}.").
3. Proof bullets (count from cover_bullets in policy.yaml). Each starts with a **bold few-word label** mapped to a JD need, then named approved proof (employer + outcome).
4. ONE closing line (e.g. "I'd welcome the chance to discuss how I'd approach X.").
5. `{approved_name}` plus the approved contact line.

## Rules
- Word cap: cover_words in policy.yaml. Concise, no filler; no former word limit is imported.
- Each statement must trace to approved claim IDs; do not merge team, role or outcome scopes.
- Distinguish hands-on ownership from hiring/managing others. Use either only when approved facts support it.
- Work-authorization placement is the current user’s choice, never inferred. Avoid repeating the posted pay range as proof.
- Current builder: `tools/build_package.py` and `lib/_native_lib.py` (`build_cover`), not an omitted historical package script.

## Placeholder example (NOT an approved candidate letter)

Dear {Company} Hiring Team,

{One self-contained fit sentence using only approved claims relevant to this role.}

- **{JD need 1}.** {Approved proof and its employer/context.}
- **{JD need 2}.** {A different approved proof; no invented metric.}
- **{JD need 3, if configured}.** {Approved evidence or omit the bullet.}

I'd welcome the chance to discuss {their role-specific problem}.

{approved_name}
{approved_contact}
