import { execSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Same posture as spikes/1-browser-loop/vite.config.ts: no Node polyfills,
// so a build that accidentally pulls in a Node-only API fails loudly.

// ---- § 10.1: one build id, in two places -------------------------------
// design-web-agent.md § 10.1: "<short git sha>-<UTC build time,
// YYYYMMDDTHHMMSSZ>" (`nogit-<time>` without git), so every build differs.
// Computed once, here, at config-eval time (Node — this file itself is not
// part of the browser bundle) and fed to BOTH the `define` (so the built-in
// id ends up inlined in the JS bundle) and the version.json plugin below
// (so one value really does feed both).
function shortGitSha(): string | undefined {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: import.meta.dirname, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim() || undefined;
  } catch {
    return undefined;
  }
}

function utcBuildTime(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  );
}

const BUILD_VERSION_ID = `${shortGitSha() ?? "nogit"}-${utcBuildTime()}`;

// A small plugin (§ 10.1) that emits version.json at the site root,
// `{"id":"<id>"}`, from the SAME id `define` inlines into the bundle.
// `generateBundle` is a Rollup (and Rolldown, per Vite 8) build hook — see
// § 10.4 (i)'s UNVERIFIED note; `npm run build` + a dist/version.json grep
// is what actually settles it for this repo's Vite 8 (Rolldown).
function versionJsonPlugin(id: string): Plugin {
  return {
    name: "ten-version-json",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ id }),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionJsonPlugin(BUILD_VERSION_ID)],
  define: {
    __TEN_VERSION__: JSON.stringify(BUILD_VERSION_ID),
  },
  build: {
    target: "es2022",
  },
});
