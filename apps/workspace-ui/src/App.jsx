import { useDeferredValue, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  ClipboardCheck,
  FilePenLine,
  FileText,
  FolderOpen,
  GraduationCap,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  PanelLeftClose,
  Search,
  Sparkles,
  Target,
  Upload,
  X,
} from "lucide-react";
import { assertWorkspaceProvider } from "./resources/contract";
import { fixtureWorkspaceProvider } from "./resources/fixture-provider";
import { useWorkspace } from "./resources/use-workspace";
import { hostAdapters } from "../shared/host-adapters.mjs";
import { copyHostHandoff } from "./host-handoff";

const navigation = [
  { id: "today", label: "Today", icon: ClipboardCheck },
  { id: "jobs", label: "Jobs", icon: BriefcaseBusiness },
  { id: "interview", label: "Interview", icon: MessageSquareText },
  { id: "documents", label: "Documents", icon: FolderOpen },
  { id: "profile", label: "Profile", icon: CircleUserRound },
  { id: "skills", label: "Skills", icon: GraduationCap },
];

const sectionMeta = {
  today: ["Today", "A short list that moves the search forward."],
  jobs: ["Jobs", "Every role has a decision, owner, and next move."],
  interview: ["Interview", "Prepare the proof, then practice the delivery."],
  documents: ["Documents", "One place for source material and deliverables."],
  profile: ["Profile", "The facts and direction every application starts from."],
  skills: ["Skills", "Close only the gaps the market keeps asking about."],
};

function LogoMark() {
  return (
    <div className="logo-mark" aria-hidden="true">
      <span>10</span>
      <i>x</i>
    </div>
  );
}

function Sidebar({ active, onNavigate, open, onClose, candidate, snapshot }) {
  return (
    <>
      {open && <button className="sidebar-scrim" aria-label="Close navigation" onClick={onClose} />}
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <LogoMark />
          <div>
            <strong>Ten</strong>
            <span>career workspace</span>
          </div>
          <button className="icon-button close-rail" onClick={onClose} aria-label="Close navigation">
            <PanelLeftClose size={18} />
          </button>
        </div>

        <div className="rail-label">Workspace</div>
        <nav aria-label="Workspace sections">
          {navigation.map((item) => {
            const Icon = item.icon;
            const count = item.id === "jobs" ? snapshot.jobs.length : item.id === "interview" ? Number(Boolean(snapshot.interview)) : item.id === "skills" ? snapshot.skills.length : 0;
            return (
              <button
                className={`nav-item ${active === item.id ? "active" : ""}`}
                key={item.id}
                onClick={() => {
                  onNavigate(item.id);
                  onClose();
                }}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
                {count > 0 && <em>{count}</em>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />
        <div className="workspace-status">
          <div className="status-heading">
            <span className="live-dot" />
            Local workspace
          </div>
          <p>{snapshot.workspaceName}</p>
          <span>{snapshot.resources.length} resources available</span>
        </div>
        <div className="account-row">
          <span className="avatar">{candidate.initials}</span>
          <span>
            <strong>{candidate.name}</strong>
            <small>Private workspace</small>
          </span>
          <MoreHorizontal size={18} />
        </div>
      </aside>
    </>
  );
}

function Topbar({ section, onMenu, query, onQuery }) {
  return (
    <header className="topbar">
      <button className="icon-button menu-button" onClick={onMenu} aria-label="Open navigation">
        <Menu size={20} />
      </button>
      <div className="crumbs">
        <span>Workspace</span>
        <ChevronRight size={14} />
        <strong>{sectionMeta[section][0]}</strong>
      </div>
      <label className="global-search">
        <Search size={16} />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Find a file or role"
          aria-label="Find a file or role"
        />
        {query && (
          <button onClick={() => onQuery("")} aria-label="Clear search">
            <X size={14} />
          </button>
        )}
        <kbd>/</kbd>
      </label>
      <button className="primary-action compact">
        <Sparkles size={15} />
        Ask Ten
      </button>
    </header>
  );
}

function PageHeading({ section, eyebrow, actions }) {
  const [title, subtitle] = sectionMeta[section];
  return (
    <div className="page-heading reveal">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}

function Pill({ children, tone = "neutral" }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function TodayView({ onNavigate, onAsk, planItems, jobs }) {
  const focusJob = jobs.find((job) => job.signal === "warm") || jobs[0];
  return (
    <div className="view-stack">
      <PageHeading section="today" eyebrow="Wednesday, August 26" />
      <section className="focus-card reveal delay-1">
        <div className="focus-copy">
          <span className="eyebrow light">Focus</span>
          <h2>{focusJob ? `Move ${focusJob.company} forward.` : "Choose the next high-value move."}</h2>
          <p>
            {planItems[0]?.detail || "Review your plan, role pipeline, and current materials before starting new work."}
          </p>
          <button className="paper-button" onClick={() => onNavigate("documents")}>
            Review the tailored resume <ArrowRight size={16} />
          </button>
        </div>
        <div className="focus-score">
          <span>Readiness</span>
          <strong>{Math.min(99, Math.max(0, focusJob?.fit || 0))}</strong>
          <small>{planItems.length} moves listed</small>
        </div>
      </section>

      <section className="section-block reveal delay-2">
        <div className="section-title-row">
          <div>
            <span className="eyebrow">Plan</span>
            <h2>What moves today</h2>
          </div>
          <button className="text-button">View full plan <ArrowRight size={15} /></button>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr><th>Order</th><th>Task</th><th>Context</th><th>Due</th><th /></tr>
            </thead>
            <tbody>
              {planItems.map((item) => (
                <tr key={item.id}>
                  <td><Pill tone={item.priority === "Now" ? "hot" : "neutral"}>{item.priority}</Pill></td>
                  <td><strong>{item.task}</strong><small>{item.detail}</small></td>
                  <td>{item.context}</td>
                  <td>{item.due}</td>
                  <td><button className="row-action" onClick={() => onAsk(item.contextRef, "work_plan")}>{item.action}<ArrowRight size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="metric-strip reveal delay-3">
        <div><span>Active roles</span><strong>{jobs.length}</strong><small>in the workspace</small></div>
        <div><span>Applied</span><strong>{jobs.filter((job) => job.stage === "Applied").length}</strong><small>currently tracked</small></div>
        <div><span>Interviews</span><strong>{jobs.filter((job) => /Interview|Recruiter|Hiring/.test(job.stage)).length}</strong><small>in progress</small></div>
        <div><span>Plan items</span><strong>{planItems.length}</strong><small>ready to work</small></div>
      </div>
    </div>
  );
}

function JobsView({ search, jobs, onAsk }) {
  const [stage, setStage] = useState("All");
  const deferredSearch = useDeferredValue(search.toLowerCase());
  const stages = ["All", ...new Set(jobs.map((job) => job.stage))];
  const filtered = jobs.filter((job) => {
    const matchesStage = stage === "All" || job.stage === stage;
    const matchesSearch = `${job.company} ${job.role}`.toLowerCase().includes(deferredSearch);
    return matchesStage && matchesSearch;
  });

  return (
    <div className="view-stack">
      <PageHeading
        section="jobs"
        eyebrow="Pipeline"
        actions={<button className="primary-action"><BriefcaseBusiness size={16} />Add role</button>}
      />
      <div className="stage-tabs reveal delay-1" role="group" aria-label="Filter jobs by stage">
        {stages.map((item) => (
          <button key={item} className={stage === item ? "active" : ""} onClick={() => setStage(item)}>
            {item}
          </button>
        ))}
      </div>
      <section className="table-shell jobs-table reveal delay-2">
        <table>
          <thead><tr><th>Role</th><th>Stage</th><th>Fit</th><th>Next move</th><th>Due</th><th /></tr></thead>
          <tbody>
            {filtered.map((job) => (
              <tr key={job.id}>
                <td>
                  <div className={`company-mark signal-${job.signal}`}>{job.company.slice(0, 1)}</div>
                  <span><strong>{job.company}</strong><small>{job.role}</small></span>
                </td>
                <td><Pill tone={job.signal === "warm" ? "green" : "neutral"}>{job.stage}</Pill></td>
                <td><div className="fit-score"><span style={{ "--fit": `${job.fit}%` }} /><strong>{job.fit}</strong></div></td>
                <td>{job.next}</td>
                <td>{job.due}</td>
                <td><button className="row-action" onClick={() => onAsk(job.contextRef, job.stage === "Interviewing" ? "prepare_interview" : "review_job")}>Ask<ArrowRight size={14} /><span className="sr-only"> about {job.company}</span></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="empty-table">No roles match this view.</div>}
      </section>
    </div>
  );
}

function InterviewView({ interview, resources }) {
  if (!interview) {
    const prepFiles = resources.filter((resource) => resource.group === "Interview");
    return (
      <div className="view-stack">
        <PageHeading section="interview" eyebrow="Preparation workspace" />
        <section className="content-card reveal delay-1 empty-state">
          <MessageSquareText size={24} />
          <h2>No structured interview is active</h2>
          <p>{prepFiles.length ? `${prepFiles.length} preparation resources are available in Documents.` : "Add interview prep material to begin a focused practice loop."}</p>
        </section>
      </div>
    );
  }
  return (
    <div className="view-stack">
      <PageHeading
        section="interview"
        eyebrow="One live process"
        actions={<button className="primary-action"><MessageSquareText size={16} />Start practice</button>}
      />
      <section className="interview-hero reveal delay-1">
        <div className="interview-date">
          <span>AUG</span><strong>28</strong><small>10:30</small>
        </div>
        <div className="interview-main">
          <Pill tone="green">Upcoming</Pill>
          <h2>{interview.company} - {interview.role}</h2>
          <p>{interview.round} / {interview.date}</p>
        </div>
        <div className="readiness-ring" style={{ "--score": `${interview.readiness * 3.6}deg` }}>
          <span><strong>{interview.readiness}</strong><small>ready</small></span>
        </div>
      </section>

      <div className="two-column-grid">
        <section className="content-card reveal delay-2">
          <div className="card-heading"><div><span className="eyebrow">Prep brief</span><h3>What to sharpen</h3></div><FileText size={20} /></div>
          <ol className="concern-list">
            {interview.concerns.map((concern, index) => <li key={concern}><span>{index + 1}</span>{concern}</li>)}
          </ol>
          <button className="text-button">Open full prep brief <ArrowRight size={15} /></button>
        </section>
        <section className="content-card reveal delay-2">
          <div className="card-heading"><div><span className="eyebrow">Story coverage</span><h3>Best proof for this round</h3></div><BookOpen size={20} /></div>
          <div className="story-list">
            {interview.stories.map((story) => (
              <div key={story.title}><span><strong>{story.title}</strong><small>{story.reps} practice reps</small></span><Pill tone={story.fit === "Strong" ? "green" : "neutral"}>{story.fit}</Pill></div>
            ))}
          </div>
        </section>
      </div>

      <section className="section-block reveal delay-3">
        <div className="section-title-row"><div><span className="eyebrow">Scoreboard</span><h2>Recent practice</h2></div><button className="text-button">View practice log</button></div>
        <div className="practice-grid">
          {interview.practice.map((rep) => (
            <article key={rep.mode}><span>{rep.mode}</span><strong>{rep.score}<small>/ 5</small></strong><p>{rep.change}</p></article>
          ))}
        </div>
      </section>
    </div>
  );
}

function DocumentsView({ search, resources, provider, onRefresh, onAsk }) {
  const deferredSearch = useDeferredValue(search.toLowerCase());
  const visibleFiles = resources.filter((file) => `${file.name} ${file.ref}`.toLowerCase().includes(deferredSearch));
  const [selectedId, setSelectedId] = useState(resources[0]?.id || null);
  const selected = resources.find((file) => file.id === selectedId) ?? visibleFiles[0] ?? resources[0];
  const [editing, setEditing] = useState(false);
  const [document, setDocument] = useState(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const uploadRef = useRef(null);
  const groups = [...new Set(visibleFiles.map((file) => file.group))];

  useEffect(() => {
    if (!selected) return;
    let current = true;
    setNotice("Loading document...");
    provider.readResource(selected.ref).then((result) => {
      if (!current) return;
      setDocument(result);
      setDraft(result.content || "");
      setNotice(result.binary ? "Preview is not available for this file type." : "");
    }).catch((error) => current && setNotice(error.message));
    return () => { current = false; };
  }, [provider, selected?.ref]);

  const save = async () => {
    try {
      setNotice("Saving...");
      const result = await provider.updateResource(selected.ref, draft, document.version);
      setDocument(result);
      setEditing(false);
      setNotice("Saved");
      await onRefresh();
    } catch (error) { setNotice(error.message); }
  };

  const upload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setNotice("Uploading...");
      await provider.uploadResource(file);
      await onRefresh();
      setNotice("Upload complete");
    } catch (error) { setNotice(error.message); }
    event.target.value = "";
  };

  if (!selected) return <div className="documents-view"><PageHeading section="documents" eyebrow="Local workspace" /><section className="content-card empty-state"><h2>No files found</h2><p>Add supported files to the workspace to view them here.</p></section></div>;

  return (
    <div className="documents-view">
      <PageHeading
        section="documents"
        eyebrow="Local workspace"
        actions={<><input ref={uploadRef} className="sr-only" type="file" accept=".md,.txt,.json,.pdf,.docx" onChange={upload} /><button className="secondary-action" onClick={() => uploadRef.current?.click()}><Upload size={16} />Upload resume</button></>}
      />
      <section className="document-workbench reveal delay-1">
        <aside className="file-tree">
          <div className="file-tree-heading"><span>Files</span><button className="icon-button"><MoreHorizontal size={17} /></button></div>
          {groups.map((group) => (
            <div className="file-group" key={group}>
              <div className="file-group-label"><ChevronDown size={14} />{group}</div>
              {visibleFiles.filter((file) => file.group === group).map((file) => (
                <button className={`file-row ${selected.id === file.id ? "active" : ""}`} key={file.id} onClick={() => { setSelectedId(file.id); setEditing(false); }}>
                  <FileText size={16} />
                  <span><strong>{file.name}</strong><small>{file.ref}</small></span>
                  <em>{file.updated?.slice?.(0, 10) || ""}</em>
                </button>
              ))}
            </div>
          ))}
          {visibleFiles.length === 0 && <p className="tree-empty">No matching files.</p>}
        </aside>
        <div className="document-pane">
          <div className="document-toolbar">
            <div><span>{selected.kind}</span><strong>{selected.name}</strong><small>{selected.ref}</small></div>
            <div>
              {notice && <span className="document-notice" role="status">{notice}</span>}
              <button className="secondary-action" disabled={!document || !selected.editable || document.binary} onClick={() => editing ? save() : setEditing(true)}>
                {editing ? <Check size={16} /> : <FilePenLine size={16} />}{editing ? "Save" : "Edit"}
              </button>
              <button className="primary-action" disabled={!document || document.binary} onClick={() => onAsk(selected.contextRef, /resume/i.test(selected.name) ? "review_resume" : "review_resource")}><Sparkles size={16} />Ask about this</button>
            </div>
          </div>
          {editing ? (
            <textarea className="document-editor" aria-label={`Edit ${selected.name}`} value={draft} onChange={(event) => setDraft(event.target.value)} />
          ) : (
            <MarkdownPreview content={document?.content || ""} />
          )}
        </div>
      </section>
    </div>
  );
}

function MarkdownPreview({ content }) {
  const lines = content.split("\n");
  return (
    <article className="markdown-preview">
      {lines.map((line, index) => {
        if (line.startsWith("# ")) return <h1 key={index}>{line.slice(2)}</h1>;
        if (line.startsWith("## ")) return <h2 key={index}>{line.slice(3)}</h2>;
        if (line.startsWith("### ")) return <h3 key={index}>{line.slice(4)}</h3>;
        if (line.startsWith("- ")) return <p className="bullet-line" key={index}>{line.slice(2)}</p>;
        if (line.startsWith("|")) return <code className="table-line" key={index}>{line}</code>;
        if (!line.trim()) return <span className="line-space" key={index} />;
        return <p key={index}>{line}</p>;
      })}
    </article>
  );
}

function ProfileView({ candidate, profileSections }) {
  return (
    <div className="view-stack">
      <PageHeading section="profile" eyebrow="Career foundation" actions={<button className="secondary-action"><FilePenLine size={16} />Edit profile</button>} />
      <section className="profile-hero reveal delay-1">
        <div className="profile-monogram">{candidate.initials}</div>
        <div><Pill tone="green">Ready to use</Pill><h2>{candidate.name}</h2><p>{candidate.headline}</p><span>{candidate.location}</span></div>
        <div className="profile-complete"><strong>84%</strong><span>foundation complete</span><div><i /></div></div>
      </section>
      <div className="profile-layout">
        <section className="content-card reveal delay-2">
          <div className="card-heading"><div><span className="eyebrow">Current direction</span><h3>{candidate.direction}</h3></div><Target size={21} /></div>
          <p className="body-copy">Lead applied AI organizations where platform quality, product adoption, and enterprise delivery must work as one system.</p>
          <div className="tag-row"><span>Applied AI</span><span>Platform</span><span>Enterprise</span><span>Executive leadership</span></div>
        </section>
        <section className="profile-facts reveal delay-2">
          {profileSections.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong><Pill>{item.state}</Pill></div>)}
        </section>
      </div>
      <section className="callout-card reveal delay-3"><Sparkles size={20} /><div><strong>One profile gap is affecting applications</strong><p>Your strongest executive-influence example is not yet in the story bank.</p></div><button className="text-button">Work on it <ArrowRight size={15} /></button></section>
    </div>
  );
}

function SkillsView({ skills, onAsk }) {
  return (
    <div className="view-stack">
      <PageHeading section="skills" eyebrow="Market evidence" actions={<button className="secondary-action"><GraduationCap size={16} />Assess a skill</button>} />
      <div className="skills-summary reveal delay-1">
        <div><strong>5</strong><span>tracked skills</span></div><div><strong>2</strong><span>credible now</span></div><div><strong>2</strong><span>in practice</span></div><div className="attention"><strong>1</strong><span>proof gap</span></div>
      </div>
      <section className="skills-list reveal delay-2">
        <div className="skills-header"><span>Skill</span><span>Demand</span><span>Evidence</span><span>Readiness</span><span /></div>
        {skills.map((skill) => (
          <div className="skill-row" key={skill.name}>
            <span><strong>{skill.name}</strong><Pill tone={skill.status === "Gap" ? "hot" : skill.status === "Credible" ? "green" : "neutral"}>{skill.status}</Pill></span>
            <span>{skill.source}</span><span>{skill.practice}</span>
            <span className="skill-strength"><i><b style={{ width: `${skill.strength}%` }} /></i><strong>{skill.strength}</strong></span>
            <button className="row-action" onClick={() => onAsk(skill.contextRef, "edit_skill")}>Ask<ArrowRight size={14} /><span className="sr-only"> about {skill.name}</span></button>
          </div>
        ))}
      </section>
      <section className="learning-card reveal delay-3"><div className="learning-icon"><GraduationCap size={24} /></div><div><span className="eyebrow">Recommended next</span><h3>Build an executive-influence story from a real decision</h3><p>Three target roles ask for board-level alignment. You have the experience, but no confirmed story packages the proof yet.</p></div><button className="paper-button">Start guided capture <ArrowRight size={16} /></button></section>
    </div>
  );
}

function SearchResults({ query, onNavigate, resources, jobs }) {
  const matches = [
    ...resources.map((file) => ({ label: file.name, detail: file.ref, section: "documents", icon: FileText })),
    ...jobs.map((job) => ({ label: `${job.company} - ${job.role}`, detail: job.stage, section: "jobs", icon: BriefcaseBusiness })),
  ].filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8);

  return (
    <div className="search-results" role="dialog" aria-label="Search results">
      <span className="eyebrow">Results</span>
      {matches.map((item) => {
        const Icon = item.icon;
        return <button key={`${item.section}-${item.label}`} onClick={() => onNavigate(item.section)}><Icon size={17} /><span><strong>{item.label}</strong><small>{item.detail}</small></span><ArrowRight size={14} /></button>;
      })}
      {matches.length === 0 && <p>No files or roles match “{query}”.</p>}
    </div>
  );
}

export function App({ provider = fixtureWorkspaceProvider }) {
  assertWorkspaceProvider(provider);
  const { snapshot, loading, error, refresh } = useWorkspace(provider);
  const [section, setSection] = useState("today");
  const [railOpen, setRailOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeRequest, setActiveRequest] = useState(null);
  const [copiedHost, setCopiedHost] = useState(null);

  const navigate = (nextSection) => {
    setSection(nextSection);
    setQuery("");
  };

  const ask = async (itemRef, action) => {
    try {
      setCopiedHost(null);
      setActiveRequest({ pending: true, visibleMessage: "Setting active context..." });
      setActiveRequest(await provider.setActiveSelection({ itemRef, action }));
    } catch (requestError) {
      setActiveRequest({ error: true, visibleMessage: requestError.message });
    }
  };

  const copyForHost = async (hostId) => {
    try {
      await copyHostHandoff(hostId, activeRequest.visibleMessage);
      setCopiedHost(hostId);
    } catch (copyError) {
      setActiveRequest((current) => ({ ...current, copyError: copyError.message }));
    }
  };

  if (error) return <div className="app-loading"><strong>Workspace unavailable</strong><span>{error}</span></div>;
  if (loading || !snapshot) return <div className="app-loading">Loading career workspace...</div>;

  const { candidate, interview, jobs, planItems, profileSections, resources, skills } = snapshot;
  return (
    <div className="app-shell">
      <Sidebar active={section} onNavigate={navigate} open={railOpen} onClose={() => setRailOpen(false)} candidate={candidate} snapshot={snapshot} />
      <div className="main-column">
        <Topbar section={section} onMenu={() => setRailOpen(true)} query={query} onQuery={setQuery} />
        {activeRequest && (
          <div className={`active-context-notice ${activeRequest.error ? "error" : ""}`} role="status">
            <Check size={17} />
            <span className="active-context-copy">
              <strong>{activeRequest.pending ? "Working" : activeRequest.error ? "Context not set" : "Ready to ask"}</strong>
              <small>{activeRequest.visibleMessage}</small>
              {activeRequest.copyError && <em>{activeRequest.copyError}</em>}
            </span>
            {!activeRequest.pending && !activeRequest.error && (
              <div className="host-handoffs" aria-label="Copy request for host">
                {hostAdapters.map((host) => (
                  <button key={host.id} onClick={() => copyForHost(host.id)} title={host.statusLabel}>
                    {copiedHost === host.id ? "Copied" : host.label}
                    <small>{host.statusLabel}</small>
                  </button>
                ))}
              </div>
            )}
            <button className="icon-button" onClick={() => setActiveRequest(null)} aria-label="Dismiss active context message"><X size={15} /></button>
          </div>
        )}
        {query && <SearchResults query={query} onNavigate={navigate} resources={resources} jobs={jobs} />}
        <main>
          {section === "today" && <TodayView onNavigate={navigate} onAsk={ask} planItems={planItems} jobs={jobs} />}
          {section === "jobs" && <JobsView search={query} jobs={jobs} onAsk={ask} />}
          {section === "interview" && <InterviewView interview={interview} resources={resources} />}
          {section === "documents" && <DocumentsView search={query} resources={resources} provider={provider} onRefresh={refresh} onAsk={ask} />}
          {section === "profile" && <ProfileView candidate={candidate} profileSections={profileSections} />}
          {section === "skills" && <SkillsView skills={skills} onAsk={ask} />}
        </main>
      </div>
    </div>
  );
}
