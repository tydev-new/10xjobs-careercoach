import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, realpath, rename, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { ActiveContextError, createItemRef, parseItemRef } from "../shared/active-context.mjs";

const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json"]);
const RESOURCE_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ".pdf", ".docx"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_EDIT_BYTES = 2 * 1024 * 1024;
const JOB_STAGES = new Set(["To Review", "Interested", "Applied", "Interviewing", "Offer"]);

export class WorkspaceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function versionOf(buffer) {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

function displayName(ref) {
  const base = path.basename(ref, path.extname(ref));
  return base.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function groupFor(ref) {
  if (ref === "base-resume.md" || ref.startsWith("documents/")) return "Resumes";
  if (ref.startsWith("applications/") || ref.startsWith("jd-inbox/") || ref.startsWith("jd-analysis/")) return "Job materials";
  if (ref.startsWith("prep/") || ref.startsWith("practice/")) return "Interview";
  if (ref.startsWith("courses/") || ref === "knowledge.md") return "Skills";
  return "Career foundation";
}

function parseJobs(markdown) {
  const rows = [];
  let stage = null;
  let current = null;
  for (const line of markdown.split("\n")) {
    const stageMatch = line.match(/^##\s+(.+?)\s*$/);
    if (stageMatch && !line.startsWith("###")) {
      stage = JOB_STAGES.has(stageMatch[1]) ? stageMatch[1] : null;
      current = null;
      continue;
    }
    const roleMatch = line.match(/^###\s+(.+?)\s+—\s+(.+?)\s*$/);
    if (roleMatch && stage) {
      current = { company: roleMatch[1], role: roleMatch[2], stage };
      rows.push(current);
      continue;
    }
    const fieldMatch = line.match(/^-\s+([^:]+):\s*(.*)$/);
    if (fieldMatch && current) current[fieldMatch[1].toLowerCase()] = fieldMatch[2];
  }
  return rows.map((row, index) => ({
    id: `job-${index}-${row.company.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    company: row.company,
    role: row.role,
    stage: row.stage,
    fit: Number.parseInt(row.score, 10) || 0,
    next: row.stage === "To Review" ? "Make verdict" : row.stage === "Interviewing" ? "Prepare interview" : "Review next move",
    due: row.updated?.slice(0, 10) || row.seen?.slice(0, 10) || "Unscheduled",
    signal: ["Interviewing", "Offer"].includes(row.stage) ? "warm" : "cool",
    sourceRef: "jobs.md",
    contextRef: createItemRef("job", `${row.company} — ${row.role}`),
  }));
}

function parsePlan(markdown) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => /^To do(?:\s|\(|$)/i.test(line.trim()));
  if (start < 0) return [];
  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (/^(Done|Waiting on you)(?:\s|\(|$)/i.test(line.trim()) || /^##\s/.test(line)) break;
    section.push(line);
  }
  return section.map((line) => line.match(/^\s*(\d+)\.\s+(.+)$/)).filter(Boolean).map((match, index) => {
    const text = match[2];
    const [task, detail = ""] = text.split(/:\s+/, 2);
    return {
      id: `plan-${match[1]}`,
      priority: index === 0 ? "Now" : index < 3 ? "Next" : "Later",
      task,
      detail,
      context: text.match(/`([^`]+)`/)?.[1] ?? "Plan",
      due: index < 2 ? "Today" : "This week",
      action: /practice|drill|mock/i.test(text) ? "Practice" : /review|approve/i.test(text) ? "Review" : "Open",
      sourceRef: "plan.md",
      contextRef: createItemRef("plan", match[1]),
    };
  });
}

function stripSource(value) {
  return value.replace(/\s*\[source:[^\]]+\].*$/i, "").replace(/\*\*/g, "").trim();
}

function parseProfile(markdown) {
  const fields = new Map();
  for (const match of markdown.matchAll(/^-\s+([^:]+):\s*(.+)$/gm)) fields.set(match[1].trim(), stripSource(match[2]));
  const name = fields.get("Name") || markdown.match(/^#\s+Profile\s+—\s+(.+)$/m)?.[1] || "Local candidate";
  const headline = fields.get("Résumé headline")?.replace(/^"|"$/g, "") || "Career profile";
  return {
    name,
    initials: name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
    headline,
    location: fields.get("Location") || "Location not recorded",
    direction: fields.get("Seniority band") || headline,
    sections: [
      { label: "Positioning", value: headline, state: "Current" },
      { label: "Level", value: fields.get("Seniority band") || "Not recorded", state: "Current" },
      { label: "Location", value: fields.get("Location") || "Not recorded", state: "Current" },
      { label: "Directness", value: fields.get("Directness preference") || "Straight", state: "Preference" },
    ],
  };
}

function parseSkills(markdown) {
  const lines = markdown.split("\n");
  const header = lines.findIndex((line) => /^\|\s*Topic\s*\|\s*Scope\s*\|/.test(line));
  if (header < 0) return [];
  return lines.slice(header + 2).filter((line) => line.startsWith("|")).map((line, index) => {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const status = cells[5] || "gap";
    return {
      id: `skill-${index}`,
      name: cells[0],
      source: cells[2] || cells[1],
      status: status.charAt(0).toUpperCase() + status.slice(1),
      practice: cells[6] && cells[6] !== "—" ? cells[6] : "Needs evidence",
      strength: status === "credible" ? 85 : status === "studying" ? 62 : 34,
      sourceRef: "knowledge.md",
      contextRef: createItemRef("skill", cells[0]),
    };
  });
}

export function createLocalWorkspace(rootInput) {
  const root = path.resolve(rootInput);
  let resolvedRoot;

  async function getRoot() {
    resolvedRoot ??= await realpath(root).catch(() => { throw new WorkspaceError(404, "workspace_missing", "Workspace folder does not exist."); });
    return resolvedRoot;
  }

  async function resolveRef(ref, { mustExist = true } = {}) {
    if (!ref || ref.includes("\0") || path.isAbsolute(ref)) throw new WorkspaceError(400, "invalid_ref", "Resource reference is invalid.");
    const segments = ref.split(/[\\/]+/);
    if (segments.some((part) => part === ".." || part.startsWith("."))) throw new WorkspaceError(400, "invalid_ref", "Hidden and parent paths are not available.");
    const normalized = path.normalize(ref);
    const rootReal = await getRoot();
    const candidate = path.resolve(rootReal, normalized);
    if (candidate !== rootReal && !candidate.startsWith(`${rootReal}${path.sep}`)) throw new WorkspaceError(403, "outside_workspace", "Resource is outside the workspace.");
    if (mustExist) {
      const candidateReal = await realpath(candidate).catch(() => { throw new WorkspaceError(404, "resource_missing", "Resource does not exist."); });
      if (!candidateReal.startsWith(`${rootReal}${path.sep}`)) throw new WorkspaceError(403, "outside_workspace", "Symlink resolves outside the workspace.");
      return candidateReal;
    }
    const parentReal = await realpath(path.dirname(candidate)).catch(() => { throw new WorkspaceError(404, "folder_missing", "Destination folder does not exist."); });
    if (parentReal !== rootReal && !parentReal.startsWith(`${rootReal}${path.sep}`)) throw new WorkspaceError(403, "outside_workspace", "Destination is outside the workspace.");
    return candidate;
  }

  async function listResources() {
    const rootReal = await getRoot();
    const resources = [];
    async function walk(directory, depth = 0) {
      if (depth > 3) return;
      const entries = await readdir(directory, { withFileTypes: true });
      await Promise.all(entries.map(async (entry) => {
        if (entry.name.startsWith(".") || entry.name === "node_modules") return;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) return walk(absolute, depth + 1);
        if (!entry.isFile() || !RESOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) return;
        const info = await stat(absolute);
        const ref = path.relative(rootReal, absolute).split(path.sep).join("/");
        resources.push({
          id: ref,
          ref,
          group: groupFor(ref),
          name: displayName(ref),
          kind: path.extname(ref).slice(1).toUpperCase(),
          updated: info.mtime.toISOString(),
          size: info.size,
          editable: TEXT_EXTENSIONS.has(path.extname(ref).toLowerCase()),
          contextRef: createItemRef("resource", ref),
        });
      }));
    }
    await walk(rootReal);
    return resources.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  }

  async function readResource(ref) {
    const absolute = await resolveRef(ref);
    const ext = path.extname(absolute).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) return { ref, binary: true, content: null, version: null };
    const buffer = await readFile(absolute);
    return { ref, binary: false, content: buffer.toString("utf8"), version: versionOf(buffer) };
  }

  async function updateResource(ref, content, expectedVersion) {
    if (typeof content !== "string" || Buffer.byteLength(content) > MAX_EDIT_BYTES) throw new WorkspaceError(413, "content_too_large", "Editable files are limited to 2 MB.");
    const absolute = await resolveRef(ref);
    if (!TEXT_EXTENSIONS.has(path.extname(absolute).toLowerCase())) throw new WorkspaceError(415, "not_editable", "This resource type is not editable.");
    const current = await readFile(absolute);
    if (!expectedVersion || versionOf(current) !== expectedVersion) throw new WorkspaceError(409, "version_conflict", "The file changed since it was opened. Reload before saving.");
    const temp = `${absolute}.ten-${randomUUID()}.tmp`;
    await writeFile(temp, content, { encoding: "utf8", mode: (await stat(absolute)).mode });
    await rename(temp, absolute);
    return readResource(ref);
  }

  async function uploadResource({ name, base64, folder = "documents" }) {
    const safeName = path.basename(name || "");
    const ext = path.extname(safeName).toLowerCase();
    if (!safeName || !RESOURCE_EXTENSIONS.has(ext)) throw new WorkspaceError(415, "unsupported_upload", "Upload a Markdown, text, JSON, PDF, or DOCX file.");
    const bytes = Buffer.from(base64 || "", "base64");
    if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new WorkspaceError(413, "upload_too_large", "Uploads must be between 1 byte and 10 MB.");
    const rootReal = await getRoot();
    const folderRef = folder === "documents" ? "documents" : "";
    await mkdir(path.join(rootReal, folderRef), { recursive: true });
    const ref = [folderRef, safeName].filter(Boolean).join("/");
    const absolute = await resolveRef(ref, { mustExist: false });
    try { await stat(absolute); throw new WorkspaceError(409, "already_exists", "A file with this name already exists."); } catch (error) { if (error instanceof WorkspaceError) throw error; }
    await writeFile(absolute, bytes, { flag: "wx" });
    return { ref };
  }

  async function snapshot() {
    const resources = await listResources();
    const readOptional = async (ref) => readResource(ref).then((result) => result.content || "").catch(() => "");
    const [jobsMd, planMd, profileMd, knowledgeMd] = await Promise.all(["jobs.md", "plan.md", "profile.md", "knowledge.md"].map(readOptional));
    const profile = parseProfile(profileMd);
    return {
      mode: "local",
      workspaceName: path.basename(await getRoot()),
      resources,
      jobs: parseJobs(jobsMd),
      planItems: parsePlan(planMd),
      candidate: profile,
      profileSections: profile.sections,
      skills: parseSkills(knowledgeMd),
      interview: null,
    };
  }

  async function resolveContextItem(itemRef) {
    const { kind, key } = parseItemRef(itemRef);
    if (kind === "resource") {
      const resources = await listResources();
      const metadata = resources.find((resource) => resource.ref === key);
      if (!metadata) throw new ActiveContextError("active_source_missing", "The selected workspace resource is unavailable.", 404);
      const source = await readResource(key);
      if (source.binary) throw new ActiveContextError("binary_context_unsupported", "This file must be converted to text before an agent can use it.", 415);
      return { kind, label: metadata.name, item: metadata, sources: [{ ref: key, version: source.version, mediaType: "text/plain", content: source.content }] };
    }

    const sourceRef = kind === "job" ? "jobs.md" : kind === "plan" ? "plan.md" : "knowledge.md";
    const source = await readResource(sourceRef).catch(() => { throw new ActiveContextError("active_source_missing", `The selected source ${sourceRef} is unavailable.`, 404); });
    const rows = kind === "job" ? parseJobs(source.content) : kind === "plan" ? parsePlan(source.content) : parseSkills(source.content);
    const item = rows.find((row) => row.contextRef === itemRef);
    if (!item) throw new ActiveContextError("active_item_missing", "The selected workspace item is no longer available.", 404);
    const label = kind === "job" ? `${item.company} — ${item.role}` : kind === "plan" ? item.task : item.name;
    return {
      kind,
      label,
      item,
      sources: [{ ref: sourceRef, version: source.version, mediaType: "text/markdown", selector: itemRef }],
    };
  }

  return { listResources, readResource, updateResource, uploadResource, snapshot, resolveContextItem };
}

export const projections = { parseJobs, parsePlan, parseProfile, parseSkills };
