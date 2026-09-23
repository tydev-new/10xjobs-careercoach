// Pure helpers from docs/design-web-agent.md — matchGateReply (§ 3),
// statusOf (§ 6.1), parsePlanTodo (§ 6.2).
//
// MOVED into packages/agent/src/helpers.ts (plan step 4, coder slice) so
// the browser package and the headless runner share the one copy; this
// file is now a thin re-export so apps/web's own imports (and
// tests/web/helpers.test.ts, which imports from THIS path) stay green.
export {
  matchGateReply,
  statusOf,
  parsePlanTodo,
  latestGateStatuses,
} from "../../../packages/agent/src/helpers.ts";
export type {
  GateReplyResult,
  ChatStatus,
  PlanTodoItem,
} from "../../../packages/agent/src/helpers.ts";
