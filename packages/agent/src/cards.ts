// § 6.2 — "the model never writes a card". After each tool result, code
// (only) applies this table to build zero or more `data-card` parts. A
// card is a receipt of a file or a script's output; reasoning stays in
// the model's prose.
import { parsePlanTodo } from "./helpers.ts";
import { findJobsMdRow } from "./jobs-md.ts";
import { parseFlagsFromCommand, tokenizeCommand } from "./shell-tokenize.ts";
import type {
  BashOutput,
  CheckerCardProps,
  DataCardData,
  DocumentCardProps,
  EstimateCostOutput,
  PlanCardProps,
  VerdictCardProps,
  WorkspaceStore,
} from "./types.ts";

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

/** command argv, e.g. `python3 evaluate/scripts/record_verdict.py --company 'Acme Labs' --title "Staff PM" --reasons "a; b"`
 *  — via the shared shell tokenizer (L8, fix round 2), so single-quoted,
 *  double-quoted, and mixed-quoted values all parse the way just-bash
 *  (and a real shell) would, not a hand-rolled regex. */
function parseFlags(command: string): Record<string, string> {
  return parseFlagsFromCommand(command);
}

function scriptName(command: string): string {
  const argv = tokenizeCommand(command);
  const scriptArg = argv[1] ?? "";
  return basename(scriptArg);
}

/** Holds the one piece of cross-tool-call state § 6.2 needs: the chat's
 *  latest checker result per checked file, for the document card's
 *  badge. One instance per chat, held by the coach for the chat's
 *  lifetime (mirrors VersionTracker). */
export class CardBuilder {
  #checkerStatusByRef = new Map<string, "clean" | "fail">();

  async forToolResult(
    toolName: string,
    input: unknown,
    output: unknown,
    workspace: WorkspaceStore,
  ): Promise<DataCardData[]> {
    if (toolName === "estimate_cost") {
      return this.#costCard(output as EstimateCostOutput);
    }
    if (toolName === "bash") {
      return this.#bashCards(input as { command: string }, output as BashOutput, workspace);
    }
    return [];
  }

  #costCard(output: EstimateCostOutput): DataCardData[] {
    return [
      {
        card: "cost",
        props: {
          action: output.action,
          lowUsd: output.lowUsd,
          highUsd: output.highUsd,
          balanceUsd: output.balanceUsd,
        },
      },
    ];
  }

  async #bashCards(
    input: { command: string },
    output: BashOutput,
    workspace: WorkspaceStore,
  ): Promise<DataCardData[]> {
    const name = scriptName(input.command);
    const flags = parseFlags(input.command);

    // § 6.2's table: record_verdict/render_resume/check_closeout each say
    // "exit 0"; check_materials.py's row has NO exit-0 condition — a
    // checker card is a receipt of what the script FOUND, including a
    // FAIL (exit 1). Only check_materials runs regardless of exit code.
    if (name === "check_materials.py") {
      return this.#checkerCards(input.command, output, flags);
    }
    if (output.exitCode !== 0) return [];
    if (name === "record_verdict.py") {
      return this.#verdictCard(flags, workspace);
    }
    if (name === "render_resume.py") {
      return this.#documentCard(output, flags);
    }
    if (name === "check_closeout.py") {
      return this.#planCard(flags, workspace);
    }
    return [];
  }

  async #verdictCard(flags: Record<string, string>, workspace: WorkspaceStore): Promise<DataCardData[]> {
    const company = flags.company;
    const title = flags.title;
    if (!company || !title) return [];
    let jobsMd = "";
    try {
      const read = await workspace.read("jobs.md");
      if (!read.binary) jobsMd = read.content;
    } catch {
      return [];
    }
    const row = findJobsMdRow(jobsMd, company, title);
    if (!row) return [];
    const props: VerdictCardProps = {
      company: row.company,
      title: row.title,
      verdict: row.verdict as VerdictCardProps["verdict"],
      score: row.score,
      track: row.track,
      reason: row.reason ?? "",
      dealbreakers: row.dealbreakers,
    };
    const card: DataCardData = { card: "verdict", props };
    if (row.jdFile) card.ref = row.jdFile;
    return [card];
  }

  #checkerCards(command: string, output: BashOutput, flags: Record<string, string>): DataCardData[] {
    // stdout: "LABEL name: pass|FAIL (n fail, m warn)" then indented
    // "  [LEVEL] msg" lines per finding, one block per checked file.
    const LABEL_TO_FLAG: Record<string, string> = { RESUME: "resume", LETTER: "letter" };
    const blockRe = /^([A-Z]+)\s+(\S+):\s+(pass|FAIL)\s+\((\d+)\s+fail,\s+(\d+)\s+warn\)\s*$/gm;
    const lines = output.stdout.split("\n");
    const cards: DataCardData[] = [];
    let match: RegExpExecArray | null;
    while ((match = blockRe.exec(output.stdout))) {
      const [, label, name, status, failCount, warnCount] = match;
      const flagKey = LABEL_TO_FLAG[label];
      const ref = flagKey ? flags[flagKey] : undefined;
      // findings: the indented "  [LEVEL] msg" lines immediately
      // following this block's header line, until a blank line.
      const headerLineIdx = lines.findIndex((l) => l.trim() === match![0].trim());
      const findings: CheckerCardProps["findings"] = [];
      for (let i = headerLineIdx + 1; i < lines.length; i++) {
        const findingMatch = lines[i].match(/^\s*\[(FAIL|WARN)\]\s+(.*)$/);
        if (!findingMatch) break;
        findings.push({ level: findingMatch[1], message: findingMatch[2] });
      }
      const props: CheckerCardProps = {
        label,
        name,
        status,
        failCount: Number.parseInt(failCount, 10),
        warnCount: Number.parseInt(warnCount, 10),
        findings,
      };
      const card: DataCardData = { card: "checker", props };
      if (ref) {
        card.ref = ref;
        this.#checkerStatusByRef.set(ref, status === "pass" ? "clean" : "fail");
      }
      cards.push(card);
    }
    return cards;
  }

  #documentCard(output: BashOutput, flags: Record<string, string>): DataCardData[] {
    const mdPath = flags.md;
    if (!mdPath) return [];
    const wordsMatch = output.stdout.match(/words:\s*(\d+)\s*->\s*(\S+)/);
    const words = wordsMatch ? Number.parseInt(wordsMatch[1], 10) : 0;
    // htmlPath only when the CALLER named an in-workspace --html path
    // (tester's own finding): without --html, render_resume.py writes to
    // a tempdir OUTSIDE the workspace and prints that path in stdout —
    // trusting the parsed stdout path there would point the side panel
    // at a file the workspace store can't read.
    const htmlPath = flags.html;
    const checker = this.#checkerStatusByRef.get(mdPath) ?? "not-run";
    const props: DocumentCardProps = { words, checker };
    if (htmlPath) props.htmlPath = htmlPath;
    return [{ card: "document", props, ref: mdPath }];
  }

  async #planCard(flags: Record<string, string>, workspace: WorkspaceStore): Promise<DataCardData[]> {
    let planMd = "";
    try {
      const read = await workspace.read("plan.md");
      if (!read.binary) planMd = read.content;
    } catch {
      return [];
    }
    const items = parsePlanTodo(planMd);
    const props: PlanCardProps = { stage: flags.stage ?? "", items };
    return [{ card: "plan", props, ref: "plan.md" }];
  }
}
