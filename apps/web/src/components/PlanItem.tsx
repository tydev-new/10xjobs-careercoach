// The plan item (design-web-ui.md § 5.3, "Pieces the pages share") — one
// component shows a plan item wherever a page shows one (Home's two
// lists today; "Next, from you" on an application, later). It runs
// `splitPlanMinutes` (C § 18.1) on the item's OWN, unstripped text: a
// line in its strict `<action> — <n> min — <why>` form shows as action +
// pill + why; any other line shows exactly as written, no pill invented.
// The text shows word for word, backticked paths included (§ 5.3 "The
// plan item": "Backticked paths inside the action stay as written";
// § 5.2 rule 3, nothing in the line is lost) — the chip is added beside
// it, never cut out of it. The chip opens the same viewer every page
// uses (§ 5.2 rule 8) — this component never writes or sends (§ 5.2 rules
// 1/2).
import type { ReactElement } from "react";
import { splitPlanMinutes, type PlanBoardItem } from "../../../../packages/agent/src/plan-board.ts";
import { Icon } from "../icons.tsx";

export function PlanItem({
  item,
  onOpenRef,
}: {
  item: PlanBoardItem;
  onOpenRef: (ref: string) => void;
}): ReactElement {
  const split = splitPlanMinutes(item.text);
  return (
    <li className="plan-item">
      {split ? (
        <>
          <div className="plan-item-row">
            <span className="plan-item-action">{split.action}</span>
            <span className="plan-item-pill">{split.minutes} min</span>
          </div>
          {split.why !== undefined ? (
            <p className="plan-item-why">{split.why}</p>
          ) : null}
        </>
      ) : (
        <p className="plan-item-text">{item.text}</p>
      )}
      {item.ref ? (
        <button type="button" className="plan-item-chip" onClick={() => onOpenRef(item.ref as string)}>
          <Icon name="fileText" size={14} />
          <span className="mono">{item.ref}</span>
        </button>
      ) : null}
    </li>
  );
}
