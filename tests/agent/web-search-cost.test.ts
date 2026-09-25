// Tester-owned: docs/design-web-agent.md § 14.4 (web search is billed per
// request; b4332f9), items (i), (ii) and (vi), from the spec's own numbers.
// (v), the ceiling, is in tests/functions/proxy_*.test.ts.
// Run: node --test tests/agent/web-search-cost.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeCostEstimate } from "../../packages/agent/src/estimate-cost.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test("§ 14.4 (i): no measured steps — {0 steps, 1 search} -> 0.035 / 0.047; {2 steps, 3 searches} -> 0.1088 / 0.146", () => {
  const a = computeCostEstimate({ steps: 0, webSearches: 1 });
  assert.ok(close(a.lowUsd, 0.035) && close(a.highUsd, 0.047), JSON.stringify(a));
  const b = computeCostEstimate({ steps: 2, webSearches: 3 });
  assert.ok(close(b.lowUsd, 2 * 0.0019 + 3 * 0.035) && close(b.highUsd, 2 * 0.0025 + 3 * 0.047), JSON.stringify(b));
});

test("§ 14.4 (ii): with measured steps the search part is the same (webSearches × 0.035 / × 0.047)", () => {
  const measuredSteps = [{ usd: 0.01 }, { usd: 0.02 }, { usd: 0.05 }];
  const none = computeCostEstimate({ steps: 4, webSearches: 0, measuredSteps });
  const two = computeCostEstimate({ steps: 4, webSearches: 2, measuredSteps });
  assert.ok(close(two.lowUsd - none.lowUsd, 2 * 0.035), JSON.stringify({ none, two }));
  assert.ok(close(two.highUsd - none.highUsd, 2 * 0.047), JSON.stringify({ none, two }));
});

test("§ 14.4 (vi): no 0.004 search price and no CEILING_SEARCH_USD_PER_RESULT left in shipped code (packages/, apps/web/src/, supabase/functions/; tests excluded)", () => {
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) {
        if (!/node_modules|^test$|^dist$/.test(f)) walk(p);
      } else if (/\.(ts|tsx|mjs|js)$/.test(f) && !/\.test\./.test(f)) {
        readFileSync(p, "utf8").split("\n").forEach((line, i) => {
          if (/CEILING_SEARCH_USD_PER_RESULT|\b0\.004\b/.test(line)) hits.push(`${path.relative(REPO, p)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
  };
  for (const d of ["packages/agent/src", "apps/web/src", "supabase/functions"]) walk(path.join(REPO, d));
  assert.deepEqual(hits, []);
});
