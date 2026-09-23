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

const VERDICT_LABEL: Record<string, string> = {
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

function VerdictCard({
  props,
  ref: fileRef,
  onOpen,
}: {
  props: VerdictCardProps;
  ref?: string;
  onOpen: (ref: string) => void;
}): ReactElement {
  const label = VERDICT_LABEL[props.verdict] ?? props.verdict;
  const isQuickScan = props.reason.toLowerCase().startsWith("quick-scan:");
  return (
    <div className="card card--verdict">
      <div className="card-title">
        {props.company} — {props.title}: {label}
        {props.track ? ` (Track ${props.track})` : ""}
      </div>
      {isQuickScan ? <span className="badge badge--quick-scan">quick-scan</span> : null}
      <p className="card-body">{props.reason}</p>
      <p className="card-meta">
        {typeof props.score === "number" ? `Score ${props.score}. ` : ""}
        Dealbreakers: {props.dealbreakers ? props.dealbreakers : "none"}.
      </p>
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
      <div className="card-title">Plan — {props.stage}</div>
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
      <div className="card-title">
        Document — {props.words} words · checker{" "}
        <span className={`badge badge--${props.checker}`}>{props.checker}</span>
      </div>
      <div className="card-actions">
        {fileRef ? <OpenInPanel onOpen={() => onOpen(fileRef)} /> : null}
        {props.htmlPath ? (
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
      <div className="card-title">
        {props.label} {props.name}:{" "}
        <span className={`badge badge--${props.status === "pass" ? "pass" : "fail"}`}>
          {props.status}
        </span>{" "}
        ({props.failCount} fail, {props.warnCount} warn)
      </div>
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
      <div className="card-title">Cost estimate — {props.action}</div>
      <p className="card-body">
        {/* Straight off estimate_cost's own return — no widening by the
            UI (design-web-ui.md § 2.6). formatUsd only ever ADDS decimals
            (at least 2), never rounds one off (L3). */}
        ${formatUsd(props.lowUsd)}–${formatUsd(props.highUsd)}, balance ${formatUsd(props.balanceUsd)}
      </p>
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
