import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locates the repository root (the directory containing package.json) by walking up from this
 * file. Works both when running from source (`src/server/runtime/`) via tsx and from the
 * compiled output (`dist/src/server/runtime/`), so the server can find `public/` and `certs/`
 * regardless of how it was launched. `PLZBOT_ROOT` overrides the search.
 */
export function findRepoRoot(): string {
  if (process.env.PLZBOT_ROOT) return path.resolve(process.env.PLZBOT_ROOT);
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "public"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const REPO_ROOT = findRepoRoot();
export const PUBLIC_DIR = process.env.PLZBOT_PUBLIC_DIR ? path.resolve(process.env.PLZBOT_PUBLIC_DIR) : path.join(REPO_ROOT, "public");
