// A minimal, dependency-free renderer of "plain formatted text" for .md
// files in the side panel (design-web-ui.md § 1.1: "render .md as plain
// formatted text"). Not a full Markdown parser — headings, bullets, bold,
// inline code, and tables only, which is what the fixtures use.
import { Fragment, type ReactElement, type ReactNode } from "react";

function inline(text: string, key: string): ReactNode {
  // **bold** and `code`, left to right, non-overlapping.
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={`${key}-${i++}`}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(
        <code key={`${key}-${i++}`} className="inline-code">
          {token.slice(1, -1)}
        </code>
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Fragment key={key}>{parts}</Fragment>;
}

export function MarkdownView({ content }: { content: string }): ReactElement {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] | null = null;
  let table: string[][] | null = null;

  const flushList = (key: string) => {
    if (list) {
      blocks.push(
        <ul key={key}>
          {list.map((item, i) => (
            <li key={i}>{inline(item, `${key}-li-${i}`)}</li>
          ))}
        </ul>
      );
      list = null;
    }
  };
  const flushTable = (key: string) => {
    if (table && table.length) {
      const [header, ...rows] = table;
      blocks.push(
        <table key={key}>
          <thead>
            <tr>
              {header.map((c, i) => (
                <th key={i}>{c.trim()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci}>{c.trim()}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
      table = null;
    }
  };

  lines.forEach((line, i) => {
    const key = `l${i}`;
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const tableRow = line.match(/^\|(.+)\|$/);

    if (tableRow) {
      flushList(key);
      const cells = tableRow[1].split("|");
      if (cells.every((c) => /^\s*:?-+:?\s*$/.test(c))) return; // separator row
      table = table ?? [];
      table.push(cells);
      return;
    }
    flushTable(key);

    if (heading) {
      flushList(key);
      const level = heading[1].length;
      const Tag = `h${Math.min(level + 1, 6)}` as "h2" | "h3" | "h4" | "h5" | "h6";
      blocks.push(<Tag key={key}>{inline(heading[2], key)}</Tag>);
      return;
    }
    if (bullet) {
      list = list ?? [];
      list.push(bullet[1]);
      return;
    }
    flushList(key);
    if (line.trim() === "") {
      blocks.push(<div key={key} className="md-gap" />);
    } else {
      blocks.push(<p key={key}>{inline(line, key)}</p>);
    }
  });
  flushList("end");
  flushTable("end");

  return <div className="markdown-view">{blocks}</div>;
}
