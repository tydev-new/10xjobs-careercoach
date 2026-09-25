// Tester-owned: docs/design-web-agent.md § 11.7 ("Delete: ten-delete-account
// deletes the caller's row") and § 11.9 (ix) "Delete (twice) leaves no row",
// written from the spec (§ 11 owner answers at 6641e1a). Runs the deployed
// entry (index.ts) against the tester's mock PostgREST, which refuses an
// unfiltered delete and any filter column the table doesn't have.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { conversation, DEL, harness, member, preq, t } from "./_harness.ts";

async function del(tok: string) {
  const h = await harness();
  const res = await h.del(preq({}, { url: DEL, token: tok }));
  return { res, txt: await res.text() };
}

t("delete (§ 11.7): the caller's saved conversation is deleted; another user's survives; twice leaves no row and still succeeds", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const [b] = await member(h);
  conversation(h.st, a);
  conversation(h.st, b);
  const first = await del(ta);
  assertEquals(first.res.status, 200, first.txt);
  assertEquals(h.st.conversations.filter((c) => c.user_id === a), [], "A's conversation row is gone");
  assertEquals(h.st.conversations.filter((c) => c.user_id === b).length, 1, "B's conversation is untouched");
  const body = JSON.parse(first.txt);
  assertEquals(body?.deleted?.conversationRows, 1, `the summary counts it: ${first.txt}`);
  const deletes = h.st.requests.filter((r) => r.method === "DELETE" && r.path.startsWith("/rest/v1/ten_conversations"));
  assertEquals(deletes.length, 1);
  assert(deletes[0].path.includes(`user_id=eq.${a}`), `filtered by the caller's id: ${deletes[0].path}`);
  assert(deletes[0].auth.includes(h.serviceKey), "sent with the service role, like the other row deletes");

  const second = await del(ta);
  assertEquals(second.res.status, 200, second.txt);
  assertEquals(JSON.parse(second.txt)?.deleted?.conversationRows, 0, "idempotent: nothing left");
  assertEquals(h.st.conversations.filter((c) => c.user_id === a), []);
});

t("delete (§ 11.7): a member with no saved conversation deletes cleanly (0 rows)", async () => {
  const h = await harness();
  h.reset();
  const [, ta] = await member(h);
  const r = await del(ta);
  assertEquals(r.res.status, 200, r.txt);
  assertEquals(JSON.parse(r.txt)?.deleted?.conversationRows, 0);
});
