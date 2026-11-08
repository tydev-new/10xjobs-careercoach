---
name: Hiring manager idea email
description: >-
  Use when writing a cold email to a hiring manager or recruiter after (or
  alongside) an application, pitching one grounded idea for the role to win an
  interview. Drafts only; the candidate sends.
---
# Hiring manager idea email

Goal: one short email that gets an interview by showing the candidate already understands the team's real problem. Pairs with the Job search outreach skill (contacts, Next Play bar); this is the step-by-step craft.

## 0. Decide whether this company deserves it (all five must hold)
1. **Strong fit:** a role the candidate truly wants, with proof that maps directly.
2. **Small enough to be read:** usually Series A-C, where the CTO, a founder, or a named leader reads cold email. Skip big brand-name companies with heavy screening.
3. **Public material to ground an idea:** blogs, case studies, or webinars describing customer problems in the company's own words.
4. **A real problem the candidate's background speaks to.**
5. **A reachable person with a reason to contact them:** the hiring manager, someone who invited outreach, or the recruiter, with a findable email or a LinkedIn backup.

If any of these fails, do a standard application plus a short note instead. Each deep apply takes about 1-2 hours, so aim for 2-4 a week, top choices first.

## 1. Research the company's own words (before drafting)
- Read the posting, the application receipt email, and every blog, case study, webinar, or resource it links. Save notes with quotes and URLs in the prep folder.
- Extract a **ranked list of problems** the company says its customers or team face, each with a source quote. Show it to the candidate before picking an idea.
- Check each problem against the company's own claims. Don't pitch a fix for something they say already works (e.g. "pilots stall" vs. their stated high pilot success rate); distinguish industry-wide problems from the company's own.
- Check whether the company already does the idea. If their blog describes it, the pitch must name what is new (e.g. running it earlier, on historical data, before go-live).

## 2. Pick recipients
- Prefer the real hiring manager (often CTO/founder at small companies). If the reporting manager can't be found, pick people with a reason: someone who publicly invited outreach, plus the recruiter who owns hiring.
- Address everyone in one email ("Hi A and B,") instead of separate notes when they work together.
- Guess email patterns only with a public signal; tell the candidate addresses are unverified and suggest a LinkedIn backup.

## 3. Let the candidate shape the idea
- Offer options, but adopt the candidate's own hypothesis when they give one. Frame it as an **idea or hypothesis, never a plan**: they lack inside data.

## 4. Structure (about 150-200 words)
1. **Role up front:** "I'm X. I applied this week for <exact title>, and my resume is attached." Add a true reason for writing to them (e.g. their post).
2. **What impressed them:** one specific, sourced line about the company.
3. **Bridge:** one line linking the candidate's background to the company's customers.
4. **Two proof bullets:** confirmed facts only, with exact scope (the team size for *that* title, not another role's).
5. **Curious question plus idea:** a short question that tests the hypothesis ("Does much of the time go into ...?"), then the idea in one or two sentences, then its concrete benefit. Cite their blog if the idea builds on it.
6. **Light offer:** "If that's useful, I'd love to help build it."
7. **Ask:** "I'd love to chat about the role."

Subject: `<Role title>: my application and an idea for <their outcome>`. Clear and respectable; avoid "plan", "requesting", or hype.

## 5. Review pass before showing the final draft
- Each claim is grounded in confirmed candidate facts; flag gaps, never fill them.
- Remove overclaims: say "helps map" rather than "discovers", and drop unverifiable promises like "ROI in weeks" in favor of "prove value early".
- Each idea should be one connected thing, not two projects.
- Wording is unambiguous for the reader (e.g. their term "firm" vs. "client"; what "go-live" means).
- List likely pushback with a one-line answer to each, so the candidate is ready for a reply.
- Show the whole email after each round of edits.

## 6. Draft mechanics (Gmail)
- Only after the host-approved draft flow and user authorization, create the Gmail draft, then attach the resume with UploadFile to the draftId (base64 in create_draft fails).
- Never update_draft once a draft has an attachment: create a new draft, attach, delete the old one, so only one draft exists.
- The candidate sends. Once they say it's sent, log recipients, subject, the idea, and the date to memory for follow-up (one follow-up after about a week).
