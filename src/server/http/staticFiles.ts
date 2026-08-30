import fs from "node:fs";
import path from "node:path";
import type { Handler } from "./router.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** Serves files under `root`, with a directory-traversal guard. Falls through to `next()`
 * (returns false) if no file matches, so callers can 404 or defer to another handler. */
export function createStaticHandler(root: string): (pathname: string) => { body: Buffer; contentType: string } | null {
  const resolvedRoot = path.resolve(root);

  return (pathname: string) => {
    const relative = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.resolve(resolvedRoot, "." + relative);
    if (!filePath.startsWith(resolvedRoot)) return null; // traversal attempt
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;

    const ext = path.extname(filePath);
    return {
      body: fs.readFileSync(filePath),
      contentType: MIME_TYPES[ext] ?? "application/octet-stream",
    };
  };
}

export function serveStatic(root: string): Handler {
  const resolve = createStaticHandler(root);
  return (req, res) => {
    const url = new URL(req.url ?? "/", "https://placeholder.invalid");
    const file = resolve(url.pathname);
    if (!file) {
      res.statusCode = 404;
      res.setHeader("content-type", "text/plain");
      res.end("Not found");
      return;
    }
    res.setHeader("content-type", file.contentType);
    res.end(file.body);
  };
}
