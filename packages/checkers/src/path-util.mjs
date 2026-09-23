// POSIX-only path helpers. No `node:path` import — this file (like every
// file under src/) runs in the browser and on a server, so it re-implements
// the handful of path operations the ports need directly on strings.
// Python's os.path.* runs on the host OS (POSIX in every place this repo
// runs: CI, the candidate's machine, the browser sandbox), so a pure POSIX
// implementation is faithful to what the real scripts actually do here.

export function join(...parts) {
  const nonEmpty = parts.filter((p) => p !== "" && p !== undefined && p !== null);
  if (nonEmpty.length === 0) return ".";
  let out = "";
  for (const p of nonEmpty) {
    if (out === "") out = p;
    else if (p.startsWith("/")) out = out.replace(/\/+$/, "") + p; // an absolute part re-roots, matching os.path.join
    else out = out.endsWith("/") ? out + p : `${out}/${p}`;
  }
  return normalize(out);
}

export function normalize(p) {
  if (p === "") return ".";
  const isAbs = p.startsWith("/");
  const parts = p.split("/");
  const out = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!isAbs) out.push("..");
    } else {
      out.push(part);
    }
  }
  let result = out.join("/");
  if (isAbs) result = "/" + result;
  if (result === "") result = isAbs ? "/" : ".";
  return result;
}

export function dirname(p) {
  const norm = p.replace(/\/+$/, "");
  const idx = norm.lastIndexOf("/");
  if (idx === -1) return ".";
  if (idx === 0) return "/";
  return norm.slice(0, idx);
}

export function basename(p) {
  const norm = p.replace(/\/+$/, "");
  const idx = norm.lastIndexOf("/");
  return idx === -1 ? norm : norm.slice(idx + 1);
}

export function isAbsolute(p) {
  return p.startsWith("/");
}

export function relative(from, to) {
  const a = normalize(from).split("/").filter(Boolean);
  const b = normalize(to).split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const up = a.length - i;
  const rel = [...Array(up).fill(".."), ...b.slice(i)];
  return rel.length ? rel.join("/") : ".";
}
