// design-web-ui.md § 5.3.1 O1-O5, word for word (design-web-agent.md § 20.5:
// "every new or changed string is a row in § 5.3.1"). Plain strings, no JSX,
// so a unit test can import them under Node and compare each with the row.
// Browser-safe: no window/document/localStorage/node:*.

/** The claim's refusals that land on the not-a-member screen (C § 20.1). A
 *  failed call is not one of them: that is the setup error screen with Q1 and
 *  Retry (C § 20.4). */
export type NotAMemberReason = "paused" | "unconfirmed" | "already_claimed";

/** O1, `<amount>` being the claim's `usd`, two decimals. Shown on the page
 *  load where the grant happened, until the first message is sent. It names
 *  the balance chip, not a spend gate: at $1.00 none ever opens (C § 20.5). */
export function welcomeLine(usd: number): string {
  return `You have $${usd.toFixed(2)} of free credit to try Ten. Each reply uses some of it, and your balance at the top shows what's left.`;
}

/** O2, O3, O4. O4's contact is the owner's (2026-10-02). */
export const NOT_A_MEMBER_LINES: Record<NotAMemberReason, string> = {
  paused: "Ten has paused free credit for new accounts, so this account can't start yet. Come back later to check again.",
  unconfirmed:
    "Ten's free credit needs a confirmed email address, and this account doesn't have one yet. If we sent you a confirmation email, open its link, then come back.",
  already_claimed:
    "Ten gives free credit once per email inbox, and this inbox has already had it. To ask to join, email support@10xjobs.co.",
};

/** O5: on the sign-in page, under the form, in both modes. */
export const SIGN_IN_INVITATION = "New accounts get free credit to try Ten, while places last.";
