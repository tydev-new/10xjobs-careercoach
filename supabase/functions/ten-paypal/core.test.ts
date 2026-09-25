import { assertEquals } from "jsr:@std/assert@1";
import { captureRequestId, pathTail } from "./core.ts";

Deno.test("pathTail: strips the function's own path prefix, keeps the tail", () => {
  assertEquals(pathTail(new URL("http://localhost/functions/v1/ten-paypal/create-order")), "/create-order");
  assertEquals(pathTail(new URL("http://localhost/ten-paypal/capture-order")), "/capture-order");
  assertEquals(pathTail(new URL("http://localhost/ten-paypal")), "/");
  assertEquals(pathTail(new URL("http://localhost/something-else")), "/something-else");
});

Deno.test("captureRequestId: § 17.1 step 4's exact shape", () => {
  assertEquals(captureRequestId("order-abc"), "ten-capture-order-abc");
});
