// Tester-owned (not product code): design-web-ui.md § 5.2 rule 1's restore
// ruling — "Pages and the rail receive only `messages` and `status` as
// props, never the `useChat` object. ... The same e2e run spies on every
// function `useChat` returns; zero calls from any page or from the rail."
//
// The stage3c-review harness build aliases the bare "@ai-sdk/react" import
// to this module (tests/web/stage3c-review.test.ts, `resolve.alias`), so the
// REAL RealChatShell gets the real useChat, with every function it returns
// wrapped. A wrapper is created once per name and forwards to the latest
// real function, so identities stay stable across renders (an effect that
// lists one in its deps behaves as it does unwrapped). Each call is
// recorded in window.__chatCalls while window.__chatSpyOn is true; the test
// turns it on only after load, so the shell's own start-up calls (restore,
// reconcile) are not counted as a page's.
import { useRef } from "react";
// The real module, by path, so the alias above does not loop back here.
import * as real from "../../../apps/web/node_modules/@ai-sdk/react/dist/index.js";
export * from "../../../apps/web/node_modules/@ai-sdk/react/dist/index.js";

declare global {
  interface Window {
    __chatCalls: string[];
    __chatSpyOn: boolean;
    __chatFns: string[];
  }
}
window.__chatCalls = [];
window.__chatSpyOn = false;
window.__chatFns = [];

export function useChat(...args: unknown[]): any {
  const chat = (real.useChat as any)(...args);
  const latest = useRef<Record<string, (...a: unknown[]) => unknown>>({});
  const wrappers = useRef<Record<string, (...a: unknown[]) => unknown>>({});
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(chat)) {
    const v = chat[key];
    if (typeof v === "function") {
      latest.current[key] = v;
      if (!wrappers.current[key]) {
        wrappers.current[key] = (...a: unknown[]) => {
          if (window.__chatSpyOn) window.__chatCalls.push(key);
          return latest.current[key](...a);
        };
      }
      out[key] = wrappers.current[key];
    } else {
      Object.defineProperty(out, key, { get: () => chat[key], enumerable: true });
    }
  }
  window.__chatFns = Object.keys(wrappers.current).sort();
  return out;
}
