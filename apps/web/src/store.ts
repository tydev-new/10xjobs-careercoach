// FixtureStore — a WorkspaceStore (docs/design-web-agent.md § 2) backed by
// a fixture's `files` (C § 6.1: "the seed workspace ... as of the end of
// the conversation — the panel only needs current files"). Read is async
// per the contract, so the real store (step 5b) is a drop-in swap. No
// window/document/localStorage/Node-only API.
import type { FileInfo, FileRead, Fixture, WorkspaceErrorCode, WorkspaceStore } from "./types.ts";
import { WorkspaceError } from "./types.ts";

export type FileKind = "markdown" | "html" | "other";

export function kindOf(path: string): FileKind {
  if (path.endsWith(".md") || path.endsWith(".txt")) return "markdown";
  if (path.endsWith(".html")) return "html";
  return "other";
}

interface Entry {
  content: string;
  version: string;
  updatedAt: string;
}

const EDITABLE_EXTENSIONS = [".md", ".txt", ".json", ".html"];

function isEditable(path: string): boolean {
  return EDITABLE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

export class FixtureStore implements WorkspaceStore {
  private files: Map<string, Entry>;
  private nextVersion = 1;
  private readonly declaredStartingBalanceUsd: number | undefined;

  constructor(fixture: Fixture) {
    const now = new Date(0).toISOString();
    this.files = new Map(
      Object.entries(fixture.files).map(([path, content]) => [
        path,
        { content, version: `v${this.nextVersion++}`, updatedAt: now },
      ])
    );
    // L1 (fix round 2): "no files" does NOT mean $0 — gate-moment.json has
    // an empty `files` too, but it's mid-conversation, not a new account.
    // Only a fixture that explicitly says so (its own `meta.startingBalanceUsd`)
    // gets a number; every other fixture is "unknown" until a streamed part
    // says otherwise.
    const declared = fixture.meta?.startingBalanceUsd;
    this.declaredStartingBalanceUsd = typeof declared === "number" ? declared : undefined;
  }

  async list(dir = ""): Promise<FileInfo[]> {
    const prefix = dir && !dir.endsWith("/") ? `${dir}/` : dir;
    const out: FileInfo[] = [];
    for (const [path, entry] of this.files) {
      if (prefix && !path.startsWith(prefix)) continue;
      out.push(this.toFileInfo(path, entry));
    }
    return out;
  }

  async read(path: string): Promise<FileRead> {
    const entry = this.files.get(path);
    if (!entry) throw new WorkspaceError("resource_missing", `no such file: ${path}`);
    return { ...this.toFileInfo(path, entry), binary: false, content: entry.content };
  }

  async write(path: string, content: string, expectedVersion: string | null): Promise<FileInfo> {
    if (!isEditable(path)) throw new WorkspaceError("not_editable", path);
    const existing = this.files.get(path);
    if (existing) {
      if (expectedVersion === null) throw new WorkspaceError("already_exists", path);
      if (existing.version !== expectedVersion) throw new WorkspaceError("version_conflict", path);
    } else if (expectedVersion !== null) {
      throw new WorkspaceError("invalid_ref", `read_first: ${path}`);
    }
    const entry: Entry = { content, version: `v${this.nextVersion++}`, updatedAt: new Date().toISOString() };
    this.files.set(path, entry);
    return this.toFileInfo(path, entry);
  }

  async upload(path: string, bytes: Uint8Array): Promise<FileInfo> {
    if (this.files.has(path)) throw new WorkspaceError("already_exists", path);
    const entry: Entry = {
      content: `(binary, ${bytes.byteLength} bytes)`,
      version: `v${this.nextVersion++}`,
      updatedAt: new Date().toISOString(),
    };
    this.files.set(path, entry);
    return this.toFileInfo(path, entry);
  }

  /** Mock-preview-only extension, not part of C § 2: the fixture's own
   *  explicit `meta.startingBalanceUsd`, if it has one. Real balance always
   *  comes from deps.balance() (C § 8) or a streamed cost card — this
   *  covers only the one case neither can: the very first screen, before
   *  any turn has run. `undefined` means "unknown", which the UI renders
   *  as "—" (L1), never an invented number. */
  startingBalanceUsd(): number | undefined {
    return this.declaredStartingBalanceUsd;
  }

  private toFileInfo(path: string, entry: Entry): FileInfo {
    return {
      path,
      version: entry.version,
      size: entry.content.length,
      updatedAt: entry.updatedAt,
      editable: isEditable(path),
    };
  }
}

export type { WorkspaceErrorCode };
