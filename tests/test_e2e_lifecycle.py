"""End-to-end integration test exercising the complete candidate lifecycle
across all 9 consolidated skills:
  1. profile (setup, intake, base-resume, pitch loop, linkedin audit)
  2. storybank (story capture, STAR structure, coverage map)
  3. search (plan composition, ATS discovery, pipeline board)
  4. evaluate (dealbreaker screening, JD decode, company brief, verdict recording)
  5. apply (tailoring, proposal blocks, cover letters, submission gate)
  6. outreach (contact discovery, signal enrichment, warm intro, send gate)
  7. interview (prep brief, live mock drills, question bank, post-round debrief)
  8. learn (domain knowledge map, assessment quiz, researched course)
  9. coach (weekly mirror loop, stage sensing, closeout check, pipeline sync)
"""
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILLS = os.path.join(ROOT, "skills")
PROFILE_SCRIPTS = os.path.join(SKILLS, "profile", "scripts")
COACH_SCRIPTS = os.path.join(SKILLS, "coach", "scripts")
STORYBANK_SCRIPTS = os.path.join(SKILLS, "storybank", "scripts")
APPLY_SCRIPTS = os.path.join(SKILLS, "apply", "scripts")
OUTREACH_SCRIPTS = os.path.join(SKILLS, "outreach", "scripts")
LEARN_SCRIPTS = os.path.join(SKILLS, "learn", "scripts")
EVALUATE_SCRIPTS = os.path.join(SKILLS, "evaluate", "scripts")
SEARCH_SCRIPTS = os.path.join(SKILLS, "search", "scripts")

sys.path.insert(0, PROFILE_SCRIPTS)
import check_files as cf


def run_py(script_path, *args):
    cmd = [sys.executable, script_path] + list(args)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    return proc.returncode, proc.stdout, proc.stderr


def test_full_candidate_lifecycle_e2e():
    with tempfile.TemporaryDirectory() as ws:
        # =====================================================================
        # STAGE 1: PROFILE — Setup, Intake, Base Résumé, Pitch & LinkedIn Audit
        # =====================================================================
        # Setup: Install workspace-CLAUDE.md
        template_claude = open(os.path.join(SKILLS, "profile", "templates", "workspace-CLAUDE.md"), encoding="utf-8").read()
        open(os.path.join(ws, "CLAUDE.md"), "w", encoding="utf-8").write(template_claude)
        os.makedirs(os.path.join(ws, "documents"), exist_ok=True)
        os.makedirs(os.path.join(ws, "jd-inbox"), exist_ok=True)

        # Intake: profile.md & criteria.md
        profile_content = """# Profile

## Snapshot

- **Name:** Alex Chen
- **Location:** San Francisco, CA
- **Headline:** Staff Systems Engineer & Infrastructure Leader
- **Seniority band:** Staff (10+ yrs)
- **Directness preference:** straight

## Experience

10+ years architecting distributed data backbones and low-latency storage systems.

## Intake findings

### Positioning strengths
- Deep streaming and partition-scaling architecture expertise.

### Likely interviewer concerns
- Transitioning from hands-on engineer to technical lead manager.

### Career-narrative gaps
- Explaining short 1-year tenure in 2020 startup.

### Story seeds
- S001 50M event streaming crisis.

## Interview history
- 2026-05: 2 phone screens passed; zero on-site rejections.

## Constraints
- Work authorization: US Citizen
- Start date: 2 weeks notice

## Application defaults
- Location: San Francisco, CA
- Authorization: Authorized to work in US without sponsorship

## Other notes
"""
        open(os.path.join(ws, "profile.md"), "w", encoding="utf-8").write(profile_content)

        criteria_content = """# Search criteria

## Targets

- Staff Software Engineer
- Tech Lead Manager

## Level

- Staff / Principal

## Geo

- San Francisco Bay Area (Hybrid 2d or Remote)

## Compensation

- $250k+ base

## Dealbreakers

- Relocation outside SF Bay Area
- In-office 5 days/week

## Target companies

- Anthropic
- Writer
- Databricks

## Retired

- None

## Search plan

- ATS scraper on target list
- HN Who is Hiring monthly

## Search settings

- max_to_review: 15

## Other notes
"""
        open(os.path.join(ws, "criteria.md"), "w", encoding="utf-8").write(criteria_content)

        base_resume_content = """# Alex Chen — Staff Systems Engineer

Experienced systems architect specializing in high-throughput distributed pipelines.

## Experience

### Principal Infrastructure Engineer — CloudScale Inc (2021–Present)
- Architected distributed event stream processing 50M events/day with 99.99% availability.
- Reduced p99 query latency by 45% through custom memory-efficient indexing.

## Claim rules

- ⚠ Never say "revolutionized company infrastructure" -> say "architected distributed event stream".
- declined at intake: "managed 50 engineers" from old bio, 2026-08-20.

## Rounds

| date | round | driver | scored vs FIXED | what changed |
| 2026-08-20 | 1 | candidate | 4/4 held; unmet: none | seeded base résumé from verified career facts |
"""
        open(os.path.join(ws, "base-resume.md"), "w", encoding="utf-8").write(base_resume_content)

        pitch_content = """# Positioning & Pitch

## Core statement

Staff Systems Engineer who scales real-time data pipelines from 1M to 50M events/day without downtime.

## Variants

**Interview TMAY:**
I am a distributed systems specialist who spent the last 6 years scaling mission-critical data backbones.

**Networking:**
I build low-latency distributed streaming systems. How is your team handling throughput bottlenecks?

**Recruiter call:**
Staff Engineer looking for distributed systems or data infrastructure roles in SF.

**Career fair:**
I architect high-throughput event processing engines.

**LinkedIn hook:**
Scaling distributed data pipelines past 50M daily events without breaking the budget.

## Messages rubric

| Tier | Message |
| PRIMARY | Real-time streaming architecture |
| KEY DIFFERENTIATOR | Microsecond latency optimization |

## Rounds

| date | round | driver | scored vs FIXED | what changed |
| 2026-08-20 | 1 | candidate | 3/3 held; unmet: none | initial positioning thesis |
"""
        open(os.path.join(ws, "pitch.md"), "w", encoding="utf-8").write(pitch_content)

        linkedin_audit_content = """# LinkedIn Audit

## Profile review

- Headline: Staff Systems Engineer | Real-Time Distributed Infrastructure
- About: Engineered data backbones handling 50M events/day.

## Consistency notes

- Headline aligned with pitch.md core statement.
"""
        open(os.path.join(ws, "linkedin-audit.md"), "w", encoding="utf-8").write(linkedin_audit_content)

        # Verify Stage 1 files
        code, out, err = run_py(os.path.join(PROFILE_SCRIPTS, "check_files.py"), "--workspace", ws, "--skills", SKILLS)
        assert code == 0, f"Stage 1 check_files failed: {out}\n{err}"

        # =====================================================================
        # STAGE 2: STORYBANK — Story capture, coverage, and validation
        # =====================================================================
        os.makedirs(os.path.join(ws, "stories"), exist_ok=True)
        storybank_content = """# Storybank

## Stories

| ID | Title | Primary Skill | Strength | Status | Use Count | Last Used | Notes |
| S001 | 50M Stream Scale | Distributed Systems | 5 | confirmed | 0 | — | Scaled Kafka + Flink pipeline |

## Coverage

| Competency | Primary Story | Status |
| Distributed Systems | S001 | covered |

## Rounds

| date | story | round | what changed | scored |
| 2026-08-20 | S001 | 1 | captured live from intake | 5 |
"""
        open(os.path.join(ws, "storybank.md"), "w", encoding="utf-8").write(storybank_content)

        story_file_content = """# S001 — 50M Stream Scale

- **Primary Skill:** Distributed Systems
- **Status:** confirmed
- **Strength:** 5

## Situation & Task
CloudScale's ingestion layer buckled under unexpected 5x traffic surge causing data dropouts.

## Action
Redesigned buffering partitioning strategy and migrated partition keys to eliminate consumer skew.

## Result & Impact
Handled 50M events/day sustained with zero message loss and 45% reduction in latency.

## Earned secret
Partition key cardinality must be decoupled from client IDs to prevent hot-shard degradation.
"""
        open(os.path.join(ws, "stories", "S001-stream-scale.md"), "w", encoding="utf-8").write(story_file_content)

        code, out, err = run_py(os.path.join(STORYBANK_SCRIPTS, "check_stories.py"), "--workspace", ws)
        assert code == 0, f"Stage 2 check_stories failed: {out}\n{err}"

        # =====================================================================
        # STAGE 3: SEARCH — Sourcing, Criteria JSON, and Pipeline Board
        # =====================================================================
        jobs_content = """# Jobs Pipeline

## Active

| Company | Title | Track | Status | Fit | Reason | Date | Next Action |
| Writer | Staff Infrastructure Engineer | Staff Eng | To Review | — | swept: ATS | 2026-08-21 | decode and evaluate |

## Dismissed
"""
        open(os.path.join(ws, "jobs.md"), "w", encoding="utf-8").write(jobs_content)
        open(os.path.join(ws, "companies.md"), "w", encoding="utf-8").write("# Companies\n")
        open(os.path.join(ws, "leads.md"), "w", encoding="utf-8").write("# Leads\n")
        open(os.path.join(ws, "criteria.json"), "w", encoding="utf-8").write('{"targets": ["Staff Software Engineer"]}\n')
        open(os.path.join(ws, "autopilot-log.md"), "w", encoding="utf-8").write("# Autopilot Log\n")

        # Save JD
        open(os.path.join(ws, "jd-inbox", "writer-staff-infra.md"), "w", encoding="utf-8").write(
            "# Writer — Staff Infrastructure Engineer\n\nLooking for distributed systems expert in SF."
        )

        # =====================================================================
        # STAGE 4: EVALUATE — JD Decode, Company Brief & Verdict Record
        # =====================================================================
        os.makedirs(os.path.join(ws, "jd-analysis"), exist_ok=True)
        os.makedirs(os.path.join(ws, "company"), exist_ok=True)

        company_content = """# Company: Writer

- **Industry:** Enterprise Generative AI
- **Stage:** Series B
- **Location:** San Francisco, CA

## Sourced intelligence

- Scaled enterprise customers by 300% in last 12 months (verified: TechCrunch 2026-02).

## What could not be found

- Specific on-call rotation frequency.

## Other notes
"""
        open(os.path.join(ws, "company", "writer.md"), "w", encoding="utf-8").write(company_content)

        jd_analysis_content = """# Decode: Writer — Staff Infrastructure Engineer

- **Track:** Staff Eng
- **Fit Tier:** Strong (Score: 88)

## 1. Requirement coverage
Strong alignment with distributed streaming and latency optimization background.

## 2. Competency overlap
- Distributed Systems (Matched: S001)
- High-Throughput Pipelines (Matched: S001)

## 3. Five-dimension fit
- Skills: High
- Seniority: Exact
- Domain: Strong
- Compensation: Matches target
- Geography: SF (In-person 2 days)

## Other notes
"""
        open(os.path.join(ws, "jd-analysis", "writer-staff-infra.md"), "w", encoding="utf-8").write(jd_analysis_content)

        # Record verdict via script
        code, out, err = run_py(
            os.path.join(EVALUATE_SCRIPTS, "record_verdict.py"),
            "--workspace", ws,
            "--company", "Writer",
            "--title", "Staff Infrastructure Engineer",
            "--verdict", "strong",
            "--score", "88",
            "--track", "A",
            "--reasons", "evaluated: strong distributed systems fit"
        )
        assert code == 0, f"Stage 4 record_verdict failed: {out}\n{err}"

        # =====================================================================
        # STAGE 5: APPLY — Materials tailoring, proposal block, checks
        # =====================================================================
        os.makedirs(os.path.join(ws, "applications"), exist_ok=True)

        app_meta_content = """# Application: Writer — Staff Infrastructure Engineer

## Standard
- S001 cited with exact metrics
- Reshape-only from base résumé
- Page budget: 1 page

## Answers
- Why Writer?: Excited by large-scale enterprise LLM streaming infrastructure.

## Submission
- Status: Ready for human review

## Outreach plan
- Target: VP of Engineering

## Rounds
| date | round | driver | scored vs FIXED | what changed |
| 2026-08-22 | 1 | candidate | 3/3 held; unmet: none | tailored distributed systems bullets |
"""
        open(os.path.join(ws, "applications", "writer-staff-infra-application.md"), "w", encoding="utf-8").write(app_meta_content)

        app_resume_content = """# Alex Chen — Staff Systems Engineer

## Experience
### Principal Infrastructure Engineer — CloudScale Inc (2021–Present)
- Architected distributed event stream processing 50M events/day with 99.99% availability.
"""
        open(os.path.join(ws, "applications", "writer-staff-infra-resume.md"), "w", encoding="utf-8").write(app_resume_content)

        app_letter_content = """# Cover Letter — Writer

Dear Hiring Team,

I am writing to express my strong interest in the Staff Infrastructure Engineer role at Writer.
"""
        open(os.path.join(ws, "applications", "writer-staff-infra-cover-letter.md"), "w", encoding="utf-8").write(app_letter_content)

        code, out, err = run_py(
            os.path.join(APPLY_SCRIPTS, "check_materials.py"),
            "--workspace", ws,
            "--resume", os.path.join(ws, "applications", "writer-staff-infra-resume.md"),
            "--letter", os.path.join(ws, "applications", "writer-staff-infra-cover-letter.md")
        )
        assert code == 0, f"Stage 5 check_materials failed: {out}\n{err}"

        # =====================================================================
        # STAGE 6: OUTREACH — Contacts discovery and message checking
        # =====================================================================
        os.makedirs(os.path.join(ws, "contacts"), exist_ok=True)
        contacts_content = """# Contacts: Writer

## Leads

### Sarah Jenkins — VP Engineering
- Channel: LinkedIn InMail
- Hook: Spoke at QCon 2026 on real-time LLM inference bottlenecks.
- Draft: Loved your QCon talk on inference bottlenecks. At CloudScale I scaled streaming infrastructure to 50M daily events.

## Send log
- 2026-08-22: Sent InMail to Sarah Jenkins
"""
        open(os.path.join(ws, "contacts", "writer.md"), "w", encoding="utf-8").write(contacts_content)

        code, out, err = run_py(os.path.join(OUTREACH_SCRIPTS, "check_messages.py"), "--workspace", ws, "--contacts", os.path.join(ws, "contacts", "writer.md"))
        assert code == 0, f"Stage 6 check_messages failed: {out}\n{err}"

        # =====================================================================
        # STAGE 7: INTERVIEW — Prep Brief, Live Drill, Debrief & Comp Record
        # =====================================================================
        os.makedirs(os.path.join(ws, "prep"), exist_ok=True)
        os.makedirs(os.path.join(ws, "practice"), exist_ok=True)
        os.makedirs(os.path.join(ws, "negotiation"), exist_ok=True)

        prep_brief_content = """# Writer — Staff Infrastructure Engineer · round: System Design · date: 2026-08-28

## Interview format
60-minute virtual system design interview.

## Company culture read
Speed-oriented execution with high technical autonomy.

## Interviewer intelligence
Interviewer: Sarah Jenkins (VP Eng) — values concrete architectural tradeoffs.

## What they optimize for
1. Fault-tolerant stream processing
2. Low latency under traffic bursts
3. Pragmatic operational simplicity

## Your best positioning
Staff Systems Engineer scaling streaming infrastructure past 50M daily events.

## Fit + likely concerns & counters
- Concern: Experience with LLM-specific serving stacks?
- Counter: Streaming architecture patterns directly translate to token-generation backbones.

## Storybank health
1 confirmed story (S001, strength 5).

## Predicted questions
1. [inferred] Design a real-time event streaming pipeline with partition failover.

## Story mapping
| question | primary story + fit | backup + fit | notes |
| High throughput streaming | S001 (Strong Fit) | — | 50M event scale |

## Questions to ask
1. What is the biggest operational bottleneck in your current data pipeline?

## Questions to avoid this round
Avoid compensation queries on early technical rounds.

## Confidence
High on core distributed systems; moderate on GPU serving layer.

## Day-of cheat sheet
- 60s Reel: Scaled CloudScale pipeline from 1M to 50M events.
- Focus Cue: Clarify constraints before sketching architecture.
"""
        open(os.path.join(ws, "prep", "writer-staff-infra.md"), "w", encoding="utf-8").write(prep_brief_content)

        practice_log_content = """# Practice Log

| Date | Mode | Target | Score (per dimension + band used) | Delta (self-assessment) | Root cause | One change | Transcript | Outcome |
| 2026-08-23 | mock | Writer System Design | Substance: 5, Structure: 4, Relevance: 5, Credibility: 5, Diff: 4 (Staff band) | delta: 0 | — | Quantify partition memory footprint earlier | `practice/2026-08-23-mock-writer.md` | pass |
"""
        open(os.path.join(ws, "practice-log.md"), "w", encoding="utf-8").write(practice_log_content)

        open(os.path.join(ws, "question-bank.md"), "w", encoding="utf-8").write(
            "# Question Bank\n\n| date | company | round | question | competency | read | notes |\n| 2026-08-23 | Writer | Mock | How do you handle hot partitions? | Distributed Systems | strong | Answered via S001 |\n"
        )
        open(os.path.join(ws, "composite-target.md"), "w", encoding="utf-8").write("# Composite Target\n")

        mock_capture_content = """# Mock Session: Writer System Design (2026-08-23)

## Questions & Answers
- Q: How do you handle hot partition skew?
- A: Decouple partition keys from client IDs and introduce virtual sub-partitions.
"""
        open(os.path.join(ws, "practice", "2026-08-23-mock-writer.md"), "w", encoding="utf-8").write(mock_capture_content)

        open(os.path.join(ws, "negotiation", "writer.md"), "w", encoding="utf-8").write(
            "# Negotiation: Writer\n\n- Stated $280k base target to recruiter on 2026-08-22.\n"
        )

        # =====================================================================
        # STAGE 8: LEARN — Knowledge Map & Researched Courses
        # =====================================================================
        os.makedirs(os.path.join(ws, "courses"), exist_ok=True)

        knowledge_content = """# Knowledge Map

## Map

| Topic | Scope | Sighting Count | Depth | Status | Course File | Last Assessed |
| GPU Cluster Orchestration | track-A | 3 | Staff | studying | `courses/gpu-orchestration.md` | 2026-08-23 |

## Assessment log

- 2026-08-23: Assessed GPU Cluster Orchestration — score 7/10 at Staff depth.
"""
        open(os.path.join(ws, "knowledge.md"), "w", encoding="utf-8").write(knowledge_content)

        course_content = """# Course: GPU Cluster Orchestration

- **Research date:** 2026-08-23
- **Depth:** Staff

## Checklist
- [x] NCCL collective communication primitives
- [ ] Ring-allreduce topology vs tree-allreduce
"""
        open(os.path.join(ws, "courses", "gpu-orchestration.md"), "w", encoding="utf-8").write(course_content)

        code, out, err = run_py(os.path.join(LEARN_SCRIPTS, "check_knowledge.py"), "--workspace", ws)
        assert code == 0, f"Stage 8 check_knowledge failed: {out}\n{err}"

        # =====================================================================
        # STAGE 9: COACH — Plan Board, Log & System-Wide Invariant Closeout
        # =====================================================================
        plan_content = """# Search Plan

## Goal
Secure Staff Infrastructure Engineer role by 2026-10-31.

## Budget
15 hours/week.

## Board
- [x] Practice system design mock for Writer
- [ ] Review GPU cluster orchestration notes

## Queue
- Research Writer interview panel members
"""
        open(os.path.join(ws, "plan.md"), "w", encoding="utf-8").write(plan_content)

        plan_log_content = """# Plan Log

- 2026-08-23: planned 2 · happened 2 · unmet: none
"""
        open(os.path.join(ws, "plan-log.md"), "w", encoding="utf-8").write(plan_log_content)

        # Run Closeout Checker
        code, out, err = run_py(
            os.path.join(COACH_SCRIPTS, "check_closeout.py"),
            "--workspace", ws,
            "--stage", "interviewing"
        )
        assert code == 0, f"Stage 9 check_closeout failed: {out}\n{err}"

        # Run Master Workspace File Checker
        code, out, err = run_py(
            os.path.join(PROFILE_SCRIPTS, "check_files.py"),
            "--workspace", ws,
            "--skills", SKILLS
        )
        assert code == 0, f"Stage 9 final check_files failed: {out}\n{err}"


def test_e2e_pitch_and_linkedin_in_profile():
    """Exercise positioning operations consolidated inside profile skill."""
    with tempfile.TemporaryDirectory() as ws:
        template_claude = open(os.path.join(SKILLS, "profile", "templates", "workspace-CLAUDE.md"), encoding="utf-8").read()
        open(os.path.join(ws, "CLAUDE.md"), "w", encoding="utf-8").write(template_claude)
        open(os.path.join(ws, "profile.md"), "w", encoding="utf-8").write("""# Profile

## Snapshot
- Headline: Senior Infrastructure Engineer
- Seniority band: Senior
- Directness preference: straight

## Experience
Senior infra engineer.

## Intake findings
### Positioning strengths
- Systems architecture
### Likely interviewer concerns
- Depth in AI
### Career-narrative gaps
- None
### Story seeds
- Scaling incident

## Interview history
- None

## Constraints
- None

## Application defaults
- None
""")
        open(os.path.join(ws, "criteria.md"), "w", encoding="utf-8").write("""# Search criteria
## Targets
- Senior Infra
## Level
- Senior
## Geo
- Remote
## Compensation
- $200k+
## Dealbreakers
- None
## Target companies
- None
## Retired
- None
""")
        open(os.path.join(ws, "base-resume.md"), "w", encoding="utf-8").write("""# Résumé
## Experience
- Senior Infra
## Claim rules
- None
""")
        # Pitch creation with brief and history
        open(os.path.join(ws, "pitch-brief.md"), "w", encoding="utf-8").write("""# Pitch Brief
## FIXED
- Target: Senior Infrastructure Engineer
- Character limit: 220
## LIVING
- Draft notes
""")
        open(os.path.join(ws, "pitch.md"), "w", encoding="utf-8").write("""# Pitch
## Core statement
Senior Infrastructure Engineer who automates high-availability multi-region clouds.
## Variants
**Interview TMAY:** I scale cloud infra.
**Networking:** How do you run multi-region failover?
**Recruiter call:** Senior Infra specialist.
**Career fair:** Building resilient clouds.
**LinkedIn hook:** Zero-downtime multi-region architecture.
## Messages rubric
| Tier | Message |
| PRIMARY | Multi-region HA |
## Rounds
| date | round | driver | scored vs FIXED | what changed |
| 2026-08-24 | 1 | candidate | 2/2 held; unmet: none | initial draft |
""")
        open(os.path.join(ws, "pitch-history.md"), "w", encoding="utf-8").write("""# Pitch History
| date | round | driver | scored vs FIXED | what changed |
| 2026-08-24 | 1 | candidate | 2/2 held; unmet: none | initial draft |
""")
        open(os.path.join(ws, "linkedin-audit.md"), "w", encoding="utf-8").write("""# LinkedIn Audit
## Profile review
- Headline: Senior Infrastructure Engineer | Cloud Resilience
## Consistency notes
- Aligned with pitch.md
""")
        code, out, err = run_py(os.path.join(PROFILE_SCRIPTS, "check_files.py"), "--workspace", ws, "--skills", SKILLS)
        assert code == 0, f"Positioning in profile check failed: {out}\n{err}"


def test_e2e_interview_prep_mock_and_debrief_writes():
    """Exercise interview lifecycle: prep brief, live mock, question bank, and 4-way debrief writes."""
    with tempfile.TemporaryDirectory() as ws:
        template_claude = open(os.path.join(SKILLS, "profile", "templates", "workspace-CLAUDE.md"), encoding="utf-8").read()
        open(os.path.join(ws, "CLAUDE.md"), "w", encoding="utf-8").write(template_claude)
        open(os.path.join(ws, "profile.md"), "w", encoding="utf-8").write("""# Profile
## Snapshot
- Headline: Lead ML Engineer
- Seniority band: Lead
- Directness preference: straight
## Experience
Lead ML engineer.
## Intake findings
### Positioning strengths
- Distributed training
### Likely interviewer concerns
- Hardware costs
### Career-narrative gaps
- None
### Story seeds
- S001 training cluster
## Interview history
- None
## Constraints
- None
## Application defaults
- None
""")
        open(os.path.join(ws, "criteria.md"), "w", encoding="utf-8").write("""# Search criteria
## Targets
- Lead ML
## Level
- Lead
## Geo
- Remote
## Compensation
- $300k+
## Dealbreakers
- None
## Target companies
- None
## Retired
- None
""")
        open(os.path.join(ws, "base-resume.md"), "w", encoding="utf-8").write("""# Résumé
## Experience
- Lead ML
## Claim rules
- ⚠ Never say "trained GPT-4" -> say "optimized large transformer fine-tuning".
""")
        os.makedirs(os.path.join(ws, "prep"), exist_ok=True)
        os.makedirs(os.path.join(ws, "practice"), exist_ok=True)
        os.makedirs(os.path.join(ws, "stories"), exist_ok=True)
        os.makedirs(os.path.join(ws, "negotiation"), exist_ok=True)

        open(os.path.join(ws, "storybank.md"), "w", encoding="utf-8").write("""# Storybank
## Stories
| ID | Title | Primary Skill | Strength | Status | Use Count | Last Used | Notes |
| S001 | Cluster Recovery | ML Infrastructure | 5 | confirmed | 1 | 2026-08-24 | Used in Anthropic screen |
## Coverage
| Competency | Primary Story | Status |
| ML Infrastructure | S001 | covered |
""")
        open(os.path.join(ws, "stories", "S001-cluster-recovery.md"), "w", encoding="utf-8").write("""# S001 — Cluster Recovery
- **Primary Skill:** ML Infrastructure
- **Status:** confirmed
- **Strength:** 5
## Situation & Task
Training job deadlocked across 128 GPUs.
## Action
Implemented asynchronous gradient checkpointing and fault watchdog.
## Result & Impact
Recovered cluster within 10 minutes and saved $40k compute cost.
## Earned secret
GPU memory fragmentation can cause silent communication deadlocks before OOM.
""")

        # Prep brief
        open(os.path.join(ws, "prep", "anthropic-lead-ml.md"), "w", encoding="utf-8").write("""# Anthropic — Lead ML Engineer · round: System Design · date: 2026-08-24
## Interview format
Virtual technical design.
## Company culture read
Focus on alignment and model reliability.
## Interviewer intelligence
Interviewer: Alignment Infra Lead.
## What they optimize for
1. Training resilience
2. Safety evaluation pipelines
3. Compute efficiency
## Your best positioning
Lead ML Infra specialist optimizing multi-node GPU clusters.
## Fit + likely concerns & counters
- Concern: Experience with 10k+ GPU clusters?
- Counter: Experience with 512 GPU clusters translates directly to multi-tier NCCL topologies.
## Storybank health
1 confirmed story.
## Predicted questions
1. [inferred] How do you handle checkpointing in large training clusters?
## Story mapping
| question | primary story + fit | backup + fit | notes |
| Checkpoint recovery | S001 (Strong Fit) | — | 128 GPU scale |
## Questions to ask
1. How does your infra team balance training throughput with automated eval harnesses?
## Questions to avoid this round
Do not debate public policy.
## Confidence
High on infra; moderate on internal eval tooling.
## Day-of cheat sheet
- 60s Reel: Optimized multi-node training clusters and cut compute waste.
""")

        # Practice log with Scoreboard
        open(os.path.join(ws, "practice-log.md"), "w", encoding="utf-8").write("""# Practice Log
| Date | Mode | Target | Score (per dimension + band used) | Delta (self-assessment) | Root cause | One change | Transcript | Outcome |
| 2026-08-24 | real | Anthropic Round 1 | — | — | — | — | `practice/2026-08-24-real-anthropic.md` | pending |
| 2026-08-23 | mock | Anthropic Design | Substance: 5, Structure: 5, Relevance: 4, Credibility: 5, Diff: 4 (Lead band) | delta: 0 | — | State memory bounds first | `practice/2026-08-23-mock-anthropic.md` | pass |
""")

        # Question bank
        open(os.path.join(ws, "question-bank.md"), "w", encoding="utf-8").write("""# Question Bank
| date | company | round | question | competency | read | notes |
| 2026-08-24 | Anthropic | Round 1 | How did you detect NCCL ring deadlocks? | ML Infrastructure | strong | Answered with S001 |
""")

        # Real session capture file
        open(os.path.join(ws, "practice", "2026-08-24-real-anthropic.md"), "w", encoding="utf-8").write("""# Real Interview Debrief: Anthropic Round 1 (2026-08-24)
## Q&A Capture
- Q: How did you detect NCCL ring deadlocks?
- A: Deployed watchdog heartbeat thread monitoring socket health.
""")

        # Negotiation comp number routing
        open(os.path.join(ws, "negotiation", "anthropic.md"), "w", encoding="utf-8").write("""# Negotiation: Anthropic
- Recruiter stated comp band: $320k–$360k base + equity on 2026-08-24.
""")

        code, out, err = run_py(os.path.join(PROFILE_SCRIPTS, "check_files.py"), "--workspace", ws, "--skills", SKILLS)
        assert code == 0, f"Interview lifecycle check failed: {out}\n{err}"
        code, out, err = run_py(os.path.join(STORYBANK_SCRIPTS, "check_stories.py"), "--workspace", ws)
        assert code == 0, f"Storybank check failed: {out}\n{err}"

