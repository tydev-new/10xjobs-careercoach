// Independent tester, open sign-up review: "the request body is byte-identical
// to main for both models" (the build removed only the daily ceiling, § 20.6;
// § 8 point 4's body is unchanged). Runs the REAL handleRequest of this tree and
// of a base ref (default origin/main, extracted with `git archive` into a temp
// dir) over the same requests with stub deps, and compares the exact bytes each
// sends upstream. No network: fetchUpstream is a stub.
//
//   deno run --allow-run=git,tar --allow-read --allow-write tests/functions/body_vs_main.ts [base-ref]
//
// Not a *.test.ts file on purpose: it needs git and a temp dir, which run.py's
// deno flags don't grant.

const base = Deno.args[0] ?? "origin/main";
const repo = new URL("../../", import.meta.url).pathname;
const tmp = await Deno.makeTempDir({ prefix: "ten-body-vs-main-" });
const archive = new Deno.Command("git", { args: ["-C", repo, "archive", "--format=tar", base, "supabase/functions"], stdout: "piped" });
const tar = await archive.output();
if (!tar.success) throw new Error(`git archive ${base} failed`);
await Deno.writeFile(`${tmp}/f.tar`, tar.stdout);
const untar = await new Deno.Command("tar", { args: ["-xf", `${tmp}/f.tar`, "-C", tmp] }).output();
if (!untar.success) throw new Error("tar failed");

// deno-lint-ignore no-explicit-any
type Any = any;
const mainMod: Any = await import(`file://${tmp}/supabase/functions/ten-model-proxy/handler.ts`);
const headMod: Any = await import(new URL("../../supabase/functions/ten-model-proxy/handler.ts", import.meta.url).href);

function deps(sent: string[]): Any {
  return {
    verifyUser: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
    isMember: async () => true,
    balanceFor: async () => 5,
    betaSpendToday: async () => 0, // main's handler asks for it; HEAD's never does
    insertLedgerCall: async () => ({ ok: true }),
    fetchUpstream: async (body: unknown) => {
      sent.push(typeof body === "string" ? body : JSON.stringify(body));
      return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
    },
    log: { warn() {}, error() {}, info() {} },
    randomId: () => "rid-fixed",
    waitUntil: (p: Promise<unknown>) => void p.catch(() => {}),
  };
}
(globalThis as Any).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}) };

const msgs = [{ role: "system", content: "sys" }, { role: "user", content: "hi ünïcödé   \"q\"" }];
const tools = [{ type: "function", function: { name: "read", parameters: { type: "object", properties: {} } } }, { type: "web_search" }];
const cases: Array<[string, unknown]> = [];
for (const model of ["anthropic/claude-sonnet-5", "deepseek/deepseek-v4.1-flash"]) {
  cases.push([`${model} minimal`, { model, messages: msgs }]);
  cases.push([`${model} everything`, {
    model, messages: msgs, tools, tool_choice: "auto", temperature: 0.3, max_tokens: 99999,
    plugins: [{ id: "web", max_results: 9 }, { id: "file-parser" }], models: ["x"], max_completion_tokens: 5,
    reasoning: { effort: "high" }, web_search_options: {}, stream: false, provider: { order: ["x"] }, transforms: ["x"], user: "u",
  }]);
  cases.push([`${model} small max_tokens + web 3`, { model, messages: msgs, max_tokens: 100, plugins: [{ id: "web", max_results: 3 }] }]);
  cases.push([`${model} no max_tokens, web no count`, { model, messages: msgs, plugins: [{ id: "web" }] }]);
}

let fails = 0;
for (const [label, body] of cases) {
  const a: string[] = [], b: string[] = [];
  const mk = () => new Request("http://x/ten-model-proxy/chat/completions", {
    method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json", origin: "http://localhost:5173" }, body: JSON.stringify(body),
  });
  const ra = await mainMod.handleRequest(mk(), deps(a), { TEN_APP_ORIGIN: "https://ten.example.com" });
  const rb = await headMod.handleRequest(mk(), deps(b), { TEN_APP_ORIGIN: "https://ten.example.com" });
  await ra.body?.cancel(); await rb.body?.cancel();
  const same = a.length === 1 && b.length === 1 && a[0] === b[0];
  console.log(`[${same ? "PASS" : "FAIL"}] ${label}: upstream body byte-identical to ${base} (${b[0]?.length ?? 0} bytes; status ${ra.status}/${rb.status})`);
  if (!same) { fails++; console.log("  base:", a[0]); console.log("  head:", b[0]); }
}
await Deno.remove(tmp, { recursive: true });
console.log(`\nbody-vs-${base} failures: ${fails}`);
if (fails) Deno.exit(1);
