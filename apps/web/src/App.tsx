import { useState, type ReactElement } from "react";
import { ChatShell } from "./ChatShell";
import { FIXTURES, fixtureById } from "./fixtures";

// Follow the host's explicit choice (data-theme on <html>), else the OS setting.
function initialTheme(): "light" | "dark" {
  try {
    const stamped = document.documentElement.dataset.theme;
    if (stamped === "light" || stamped === "dark") return stamped;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function App(): ReactElement {
  const [fixtureId, setFixtureId] = useState(FIXTURES[0]?.id ?? "");
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme());

  const fixture = fixtureById(fixtureId);
  if (!fixture) {
    return <div className="app-shell">No fixtures found in apps/web/fixtures/*.json.</div>;
  }

  return (
    <div className="app-root" data-theme={theme}>
      <ChatShell
        key={fixtureId}
        entry={{ id: fixtureId, label: fixtureId, fixture }}
        fixtures={FIXTURES}
        onFixtureChange={setFixtureId}
        theme={theme}
        onThemeToggle={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
      />
    </div>
  );
}
