// § 4: "Versions are tracked by the package. Per chat, it keeps the last
// version it saw for each path, from read_file, write_file, and bash
// write-backs." One VersionTracker instance per chat, held for the
// chat's lifetime by the coach (coach.ts).
export class VersionTracker {
  #seen = new Map<string, string>();

  has(path: string): boolean {
    return this.#seen.has(path);
  }

  get(path: string): string | undefined {
    return this.#seen.get(path);
  }

  /** Records the version the package just observed for `path` (a read, a
   *  successful write, or a bash write-back). */
  record(path: string, version: string): void {
    this.#seen.set(path, version);
  }

  forget(path: string): void {
    this.#seen.delete(path);
  }
}
