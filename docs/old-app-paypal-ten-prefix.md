# Older-app patch: ignore Ten's PayPal payments

For the owner to review and deploy in the older CareerCoach repo **before**
Ten's first payment (`design-web-agent.md` § 17.6). No agent applies it.

**Why.** Both apps share one PayPal REST app, and PayPal posts each event
to every webhook URL on it. A Ten payment has `custom_id` `ten:<uuid>`;
the older webhook passes it to `activateCredit`, whose insert into the UUID
column `credit_ledger.user_id` fails, so it answers 500 and PayPal retries
25 times over 3 days. Nothing is credited wrongly; the patch makes it a
quiet 200.

**Where:** `apps/web-ui-10xjobs/app/api/webhooks/paypal/route.ts`, right
after the `event_type` check (the signature is still checked first):

```ts
  // Ten shares this PayPal REST app; it marks its payments
  // custom_id "ten:<uuid>" and credits them itself. 200 stops retries.
  if (event.resource.custom_id?.startsWith("ten:")) {
    return NextResponse.json({ status: "ignored" });
  }
```

**Test** (`apps/web-ui-10xjobs/__tests__/api/webhooks/paypal.test.ts`): a
signed `PAYMENT.CAPTURE.COMPLETED` with `custom_id: "ten:<uuid>"` returns
200 `{ status: "ignored" }` and calls neither `getPayPalCapture` nor
`activateCredit`; a bare-UUID event still credits. The capture route needs
nothing: it already refuses an order whose `custom_id` isn't the caller's.

**Known issue, a separate fix (not part of Ten's build).** The older app
credits two different amounts for one payment. Its capture route
(`packages/web-ui-shared/src/lib/billing/capture-order.ts`) credits PayPal's
net (`seller_receivable_breakdown.net_amount`); its webhook passes the
capture's `amount.value`, the gross, to `activateCredit`
(`apps/web-ui-10xjobs/lib/billing.ts`). Both key on the capture id, so
whichever lands first decides the credit: a user whose browser closed
before capture returned gets the fee too. Recommended: the webhook reads
the breakdown's `net_amount` (refusing a capture without one, as the
capture route does). Owner-reviewed, deployed on its own.
