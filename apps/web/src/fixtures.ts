// Fixture loader — Vite's import.meta.glob, eager so the dev-only picker
// (design-web-ui.md § 1) has the list synchronously. Bundled at build time;
// nothing here reaches a network or a filesystem at runtime.
import type { Fixture } from "./types";

const modules = import.meta.glob("../fixtures/*.json", { eager: true }) as Record<
  string,
  { default: Fixture }
>;

export interface FixtureEntry {
  id: string;
  label: string;
  fixture: Fixture;
}

function idFromPath(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.json$/, "");
}

export const FIXTURES: FixtureEntry[] = Object.entries(modules)
  .map(([path, mod]) => ({
    id: idFromPath(path),
    label: idFromPath(path),
    fixture: mod.default,
  }))
  .sort((a, b) => a.id.localeCompare(b.id));

export function fixtureById(id: string): Fixture | undefined {
  return FIXTURES.find((f) => f.id === id)?.fixture;
}
