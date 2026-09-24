import { StrictMode, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SHOW_MOCK_CONTROLS } from "./components/Header";
import { MissingEnvError, readEnv } from "./backend/env.ts";
import { RealApp } from "./real/RealApp";
import "./styles.css";

// Follow the host's explicit choice (data-theme on <html>), else the OS
// setting — the SAME logic as App.tsx's own initialTheme (kept there
// unchanged; duplicated here in the few lines it takes rather than
// refactoring the mock's own file for this slice).
function initialTheme(): "light" | "dark" {
  try {
    const stamped = document.documentElement.dataset.theme;
    if (stamped === "light" || stamped === "dark") return stamped;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function RealRoot(): ReactElement {
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme());
  try {
    const env = readEnv(import.meta.env as unknown as Record<string, string | undefined>);
    return <RealApp env={env} theme={theme} onThemeToggle={() => setTheme((t) => (t === "light" ? "dark" : "light"))} />;
  } catch (err) {
    if (err instanceof MissingEnvError) {
      // A plain, obviously-a-deploy-problem message — never a blank
      // screen — for the one failure mode this app can hit before any
      // network call: the Vercel env vars weren't set (see the owner
      // checklist in the coder's hand-back).
      return (
        <div className="app-shell app-shell--config-error">
          <p>Ten isn't configured: {err.missing.join(", ")} missing.</p>
        </div>
      );
    }
    throw err;
  }
}

// Plan step 5b, item 1: "swap MockChatTransport for it in production
// builds; the mock stays for dev/build:preview: a one-line swap as the
// plan promised." SHOW_MOCK_CONTROLS is exactly that switch — true under
// `npm run dev` and `npm run build:preview`, false (the real, deployed
// app) under the default `npm run build`.
const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>{SHOW_MOCK_CONTROLS ? <App /> : <RealRoot />}</StrictMode>
);
