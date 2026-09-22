export const candidate = {
  name: "Maya Chen",
  initials: "MC",
  headline: "Engineering leader building applied AI platforms",
  location: "San Francisco Bay Area",
  direction: "VP Engineering / Head of Applied AI",
};

export const planItems = [
  {
    id: "p1",
    priority: "Now",
    task: "Review Acme tailored resume",
    detail: "Resolve two claims before the recruiter screen",
    context: "Acme / VP Engineering",
    due: "Today",
    action: "Review",
  },
  {
    id: "p2",
    priority: "Next",
    task: "Practice the architecture story",
    detail: "One 8-minute rep, then tighten the tradeoff",
    context: "Interview practice",
    due: "Today",
    action: "Practice",
  },
  {
    id: "p3",
    priority: "Later",
    task: "Decide on Northstar",
    detail: "The role has been waiting for a verdict for two days",
    context: "Northstar / Director, AI Platform",
    due: "Tomorrow",
    action: "Decide",
  },
];

export const jobs = [
  {
    id: "j1",
    company: "Acme",
    role: "VP Engineering, Applied AI",
    stage: "Recruiter screen",
    fit: 88,
    next: "Resume review",
    due: "Today",
    signal: "warm",
  },
  {
    id: "j2",
    company: "Northstar",
    role: "Director, AI Platform",
    stage: "To review",
    fit: 81,
    next: "Make verdict",
    due: "Tomorrow",
    signal: "cool",
  },
  {
    id: "j3",
    company: "Lattice Labs",
    role: "Head of Engineering",
    stage: "Applied",
    fit: 76,
    next: "Follow up",
    due: "Aug 29",
    signal: "cool",
  },
  {
    id: "j4",
    company: "Pioneer",
    role: "Engineering Director, Agents",
    stage: "Hiring manager",
    fit: 91,
    next: "Prepare system design",
    due: "Sep 2",
    signal: "warm",
  },
  {
    id: "j5",
    company: "Meridian",
    role: "VP Product Engineering",
    stage: "Waiting",
    fit: 73,
    next: "Recruiter reply",
    due: "Sep 4",
    signal: "quiet",
  },
];

export const files = [
  {
    id: "f1",
    group: "Resumes",
    name: "Base resume",
    path: "base-resume.md",
    kind: "MD",
    updated: "2h",
    content: `# Maya Chen\n\nEngineering leader building applied AI platforms from first customer to reliable scale.\n\n## Experience\n\n### Atlas Systems - VP Engineering\n\n- Built the applied AI organization from 8 to 42 across platform, product, and field engineering.\n- Reframed a stalled enterprise pilot around measurable workflow adoption and moved it into production.\n- Introduced an operating review that cut critical incident recurrence while preserving weekly releases.\n\n## Claim rules\n\n- Keep team-size claims scoped to the applied AI organization.\n- Do not imply ownership of company-wide revenue.`,
  },
  {
    id: "f2",
    group: "Resumes",
    name: "Acme - tailored resume",
    path: "applications/acme-vp-engineering-resume.md",
    kind: "MD",
    updated: "18m",
    content: `# Maya Chen\n\nVP Engineering | Applied AI products and platform scale\n\n## Selected impact\n\n- Built the applied AI organization from 8 to 42 across platform, product, and field engineering.\n- Turned a stalled enterprise pilot into a production workflow by tying model quality to user adoption.\n- Established a weekly reliability review that reduced repeat critical incidents.\n\n## Reworded\n\nbase: Reframed a stalled enterprise pilot around measurable workflow adoption and moved it into production.\ntailored: Turned a stalled enterprise pilot into a production workflow by tying model quality to user adoption.`,
  },
  {
    id: "f3",
    group: "Job materials",
    name: "Acme application",
    path: "applications/acme-vp-engineering-application.md",
    kind: "MD",
    updated: "1h",
    content: `# Acme - VP Engineering application\n\n## Standard\n\n- Applied AI organization leadership\n- Enterprise product delivery\n- Platform reliability\n\n## Coverage\n\n| requirement | status | evidence | decision |\n| --- | --- | --- | --- |\n| Build a multi-disciplinary team | have | Atlas growth from 8 to 42 | answered |\n| Own enterprise outcomes | shown-but-unnamed | Production pilot story | open |`,
  },
  {
    id: "f4",
    group: "Job materials",
    name: "Acme job description",
    path: "jd-inbox/acme-vp-engineering.md",
    kind: "MD",
    updated: "3d",
    content: `# VP Engineering, Applied AI\n\nAcme is seeking an engineering leader to scale a multi-disciplinary applied AI organization and turn emerging capabilities into trusted enterprise products.\n\n## What you will do\n\n- Lead platform, product, and forward-deployed engineering.\n- Own reliability, evaluation, and customer adoption.\n- Build the operating model for rapid, responsible delivery.`,
  },
  {
    id: "f5",
    group: "Career foundation",
    name: "Profile",
    path: "profile.md",
    kind: "MD",
    updated: "6d",
    content: `# Profile\n\n## Snapshot\n\nMaya Chen - San Francisco Bay Area\nEngineering leader building applied AI platforms\nSenior leadership band\nDirectness: straight\n\n## Positioning strengths\n\n- Connects model capability to enterprise workflow adoption.\n- Has built platform, product, and field engineering together.\n- Communicates technical tradeoffs clearly with executives.`,
  },
  {
    id: "f6",
    group: "Career foundation",
    name: "Story bank",
    path: "storybank.md",
    kind: "MD",
    updated: "4d",
    content: `# Story bank\n\n## Coverage\n\nLeadership, technical depth, customer focus, and ambiguity navigation are covered. Influence without authority needs another strong example.\n\n## Stories\n\n| ID | Title | Primary skill | Strength |\n| --- | --- | --- | --- |\n| S001 | The adoption metric reset | Strategic thinking | 5 |\n| S002 | Reliability without slowing down | Execution | 4 |`,
  },
];

export const interview = {
  company: "Acme",
  role: "VP Engineering, Applied AI",
  round: "Recruiter screen",
  date: "Friday, Aug 28 - 10:30 AM",
  readiness: 72,
  concerns: [
    "Scope the 8 to 42 growth claim precisely",
    "Connect platform reliability to customer adoption",
    "Prepare a crisp reason for leaving Atlas",
  ],
  stories: [
    { title: "The adoption metric reset", fit: "Strong", reps: 3 },
    { title: "Reliability without slowing down", fit: "Strong", reps: 2 },
    { title: "Building the field engineering bridge", fit: "Workable", reps: 1 },
  ],
  practice: [
    { mode: "Opening pitch", score: "4.2", change: "Name the buyer earlier" },
    { mode: "Leadership drill", score: "3.8", change: "Make the tradeoff explicit" },
    { mode: "Full mock", score: "4.0", change: "Shorten the context setup" },
  ],
};

export const profileSections = [
  { label: "Positioning", value: "Applied AI engineering leader", state: "Strong" },
  { label: "Target", value: "VP Engineering / Head of Applied AI", state: "Current" },
  { label: "Location", value: "San Francisco Bay Area / Remote", state: "Current" },
  { label: "Compensation", value: "Discuss after scope alignment", state: "Private" },
  { label: "Work authorization", value: "Authorized to work in the US", state: "Current" },
];

export const skills = [
  { name: "AI product strategy", source: "4 target roles", status: "Credible", practice: "Story S001", strength: 86 },
  { name: "Platform reliability", source: "3 target roles", status: "Credible", practice: "Story S002", strength: 82 },
  { name: "Enterprise deployment", source: "5 target roles", status: "Studying", practice: "Course + drill", strength: 66 },
  { name: "Executive influence", source: "2 target roles", status: "Gap", practice: "Needs story", strength: 38 },
  { name: "Evaluation systems", source: "3 target roles", status: "Studying", practice: "Architecture rep", strength: 61 },
];
