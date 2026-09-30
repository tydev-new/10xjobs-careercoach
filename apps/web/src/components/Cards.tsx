import type { ReactElement } from "react";
// The card catalog (design-web-ui.md § 2). Every card is a receipt built
// from a data-card part — this file only renders `props`/`ref`, it never
// invents a number the part didn't carry (rule 8).
import type {
  CheckerCardProps,
  CostCardProps,
  DataCardData,
  DocumentCardProps,
  PlanCardProps,
  VerdictCardProps,
} from "../types";
import { formatUsd } from "../format.ts";
import { Icon } from "../icons.tsx";

// § 2.1's own tier-label table — exported so Home, Jobs and Applications
// (design-web-ui.md § 5.3: "tier label (§ 2.1's table)", P5-P8) reuse this
// ONE table instead of each page keeping its own copy (rule 12).
export const VERDICT_LABEL: Record<string, string> = {
  strong: "Strong Fit",
  investable_stretch: "Investable Stretch",
  long_shot: "Long-Shot Stretch",
  weak: "Weak Fit",
};

function OpenInPanel({ onOpen }: { onOpen: () => void }): ReactElement {
  return (
    <button type="button" className="card-open-link" onClick={onOpen}>
      Open in panel →
    </button>
  );
}

// § 5.6, "Cards — Tier pills": the words carry the meaning, color only
// marks the category. Strong Fit alone gets the check icon. Exported for
// the same reason as VERDICT_LABEL above (§ 5.3: Home, Jobs and
// Applications all show this pill from the same row/card data).
export function TierPill({ verdict }: { verdict: string }): ReactElement {
  // Object.hasOwn, not a plain index + `?? verdict`: a verdict string that
  // happens to spell an inherited Object.prototype property name
  // (`constructor`, `toString`, `hasOwnProperty`, `__proto__`) would read
  // back that PROPERTY (a function, or the prototype itself), not
  // `undefined` — `?? verdict` never catches that, and React crashes
  // trying to render a function as a child (found live, this review's own
  // build). A row-written word must always show as written when it isn't
  // one of § 2.1's own four keys, never a JS-object accident.
  const label = Object.hasOwn(VERDICT_LABEL, verdict) ? VERDICT_LABEL[verdict] : verdict;
  return (
    <span className={`tier-pill tier-pill--${verdict}`}>
      {verdict === "strong" ? <Icon name="check" size={13} /> : null}
      {label}
    </span>
  );
}

function VerdictCard({
  props,
  ref: fileRef,
  onOpen,
}: {
  props: VerdictCardProps;
  ref?: string;
  onOpen: (ref: string) => void;
}): ReactElement {
  const isQuickScan = props.reason.toLowerCase().startsWith("quick-scan:");
  return (
    <div className="card card--verdict">
      {/* the kicker keeps the company/title/track context; no fact
          dropped, just reordered by what matters first — § 5.6's own
          "Verdict" shape leads with the initial tile, the score, then
          the tier pill. */}
      <div className="card-kicker">
        Verdict · {props.company} — {props.title}
      </div>
      <div className="verdict-head">
        <div className="verdict-tile" aria-hidden="true">
          {props.company.charAt(0).toUpperCase()}
        </div>
        <div className="verdict-titles">
          <div className="card-title">{props.title}</div>
          <div className="card-meta">{props.company}</div>
        </div>
        {typeof props.score === "number" ? (
          <div className="verdict-score">
            {props.score}
            <span className="verdict-score-max">/100</span>
          </div>
        ) : null}
      </div>
      <TierPill verdict={props.verdict} />
      {isQuickScan ? <span className="badge badge--quick-scan">quick-scan</span> : null}
      <p className="card-body">{props.reason}</p>
      <p className="card-meta">Dealbreakers: {props.dealbreakers ? props.dealbreakers : "none"}.</p>
      {fileRef ? (
        <OpenInPanel onOpen={() => onOpen(fileRef)} />
      ) : (
        <span className="card-meta">no analysis file linked</span>
      )}
    </div>
  );
}

function PlanCard({
  props,
  ref: fileRef,
  onOpen,
}: {
  props: PlanCardProps;
  ref?: string;
  onOpen: (ref: string) => void;
}): ReactElement {
  const planRef = fileRef ?? "plan.md";
  return (
    <div className="card card--plan">
      <div className="card-kicker">Plan</div>
      <div className="card-title">{props.stage}</div>
      <ol className="plan-items">
        {props.items.map((item, i) => (
          <li key={i}>
            <span>{item.text}</span>
            {item.ref ? (
              <button
                type="button"
                className="card-open-link card-open-link--inline"
                onClick={() => onOpen(item.ref as string)}
              >
                open
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      <OpenInPanel onOpen={() => onOpen(planRef)} />
    </div>
  );
}

function DocumentCard({
  props,
  ref: fileRef,
  onOpen,
  onPrint,
}: {
  props: DocumentCardProps;
  ref?: string;
  onOpen: (ref: string) => void;
  onPrint: (htmlPath: string) => void;
}): ReactElement {
  return (
    <div className="card card--document">
      {/* The file name IS the receipt (design-web-ui-refresh.md — the
          ChatGPT file-edit-card pattern, filename-led): rule#8, no
          field this card didn't get from `props`/`ref`. */}
      <div className="card-kicker">Document</div>
      <div className="card-title">
        {fileRef ? <span className="card-title-file">{fileRef}</span> : "Document"}
      </div>
      <p className="card-meta">
        {/* design-web-ui.md § 5.3.1 T2: "automatic checks:", not "checker". */}
        {props.words} words · automatic checks:{" "}
        <span className={`badge badge--${props.checker}`}>
          {/* design-honest-ceilings.md § 6A: a pass with warnings never
              renders as "clean" — clean and fail read as today; not-run
              reads as "not run" (design-web-ui.md § 5.3.1 T6), the
              underlying value ("not-run") stays the CSS class suffix. */}
          {props.checker === "warn"
            ? `no failures, ${props.warnCount === 1 ? "1 warning" : `${props.warnCount ?? 0} warnings`}`
            : props.checker === "not-run"
              ? "not run"
              : props.checker}
        </span>
      </p>
      <div className="card-actions">
        {fileRef ? <OpenInPanel onOpen={() => onOpen(fileRef)} /> : null}
        {props.htmlPath && import.meta.env.VITE_HIDE_PRINT !== "1" ? (
          <button
            type="button"
            className="card-open-link"
            onClick={() => onPrint(props.htmlPath as string)}
          >
            Print / Save as PDF
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CheckerCard({
  props,
  ref: fileRef,
  onOpen,
}: {
  props: CheckerCardProps;
  ref?: string;
  onOpen: (ref: string) => void;
}): ReactElement {
  const clean = props.failCount === 0 && props.warnCount === 0;
  return (
    <div className="card card--checker">
      <div className="card-kicker">Checker · {props.label}</div>
      <div className="card-title">
        <span className="card-title-file">{props.name}</span>
      </div>
      <p className="card-meta">
        <span className={`badge badge--${props.status === "pass" ? "pass" : "fail"}`}>
          {props.status}
        </span>{" "}
        ({props.failCount} fail, {props.warnCount} warn)
      </p>
      {clean ? (
        <p className="card-body">clean</p>
      ) : (
        <ul className="checker-findings">
          {props.findings.map((f, i) => (
            <li key={i}>{typeof f === "string" ? f : `[${f.level}] ${f.message}`}</li>
          ))}
        </ul>
      )}
      {fileRef ? <OpenInPanel onOpen={() => onOpen(fileRef)} /> : null}
    </div>
  );
}

function CostCard({ props }: { props: CostCardProps }): ReactElement {
  return (
    <div className="card card--cost">
      <div className="card-kicker">Cost estimate</div>
      <div className="card-title">{props.action}</div>
      {/* A Stripe-informed receipt line (design-web-ui-refresh.md § v2):
          money as an ordinary fact, label left, amount right, tabular
          figures. Straight off estimate_cost's own return — no widening
          by the UI (design-web-ui.md § 2.6). formatUsd only ever ADDS
          decimals (at least 2), never rounds one off (L3). */}
      <div className="receipt-row">
        <span className="receipt-label">Estimated range</span>
        <span className="receipt-amount">
          ${formatUsd(props.lowUsd)}–${formatUsd(props.highUsd)}
        </span>
      </div>
      <div className="receipt-row receipt-row--total">
        <span className="receipt-label">Your balance</span>
        <span className="receipt-amount">${formatUsd(props.balanceUsd)}</span>
      </div>
    </div>
  );
}

export function Card({
  data,
  onOpen,
  onPrint,
}: {
  data: DataCardData;
  onOpen: (ref: string) => void;
  onPrint: (htmlPath: string) => void;
}): ReactElement {
  switch (data.card) {
    case "verdict":
      return <VerdictCard props={data.props as VerdictCardProps} ref={data.ref} onOpen={onOpen} />;
    case "plan":
      return <PlanCard props={data.props as PlanCardProps} ref={data.ref} onOpen={onOpen} />;
    case "document":
      return (
        <DocumentCard
          props={data.props as DocumentCardProps}
          ref={data.ref}
          onOpen={onOpen}
          onPrint={onPrint}
        />
      );
    case "checker":
      return <CheckerCard props={data.props as CheckerCardProps} ref={data.ref} onOpen={onOpen} />;
    case "cost":
      return <CostCard props={data.props as CostCardProps} />;
    default:
      return <div className="card">Unknown card</div>;
  }
}
