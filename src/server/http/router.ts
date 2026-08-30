/**
 * Minimal hand-rolled router, used instead of Express.
 *
 * Express was tried first and dropped: mounting an Express app as the request listener for
 * Node's `http2.createSecureServer` compat API reliably crashes the process on Node 25 with
 * `TypeError: Cannot read properties of undefined (reading 'readable')` inside
 * `_http_incoming.js`'s `IncomingMessage._read`, triggered by a deferred `resume()` racing the
 * HTTP/2 stream's teardown after the response completes. Confirmed via an isolated spike: the
 * exact same route handler, with the exact same http2 compat server, does not crash when
 * attached directly as the 'request' listener (no Express in between) — including with a
 * large (20KB) JSON response, which rules out payload size as the variable. Given HTTP/2
 * support is a core, non-negotiable requirement here (spec §2 "HTTP/2"), and this app's route
 * surface is small (a handful of JSON endpoints plus static file serving), a small router is
 * both safer and less code than working around Express's incompatibility.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

interface Route {
  method: string;
  path: string;
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];
  private notFoundHandler: Handler = (_req, res) => {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Not found" }));
  };

  get(path: string, handler: Handler): void {
    this.routes.push({ method: "GET", path, handler });
  }

  post(path: string, handler: Handler): void {
    this.routes.push({ method: "POST", path, handler });
  }

  notFound(handler: Handler): void {
    this.notFoundHandler = handler;
  }

  handler(): Handler {
    return async (req, res) => {
      const url = new URL(req.url ?? "/", "https://placeholder.invalid");
      const method = (req.method ?? "GET").toUpperCase();

      for (const route of this.routes) {
        if (route.method === method && route.path === url.pathname) {
          try {
            await route.handler(req, res);
          } catch (err) {
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ error: "Internal server error", detail: (err as Error).message }));
            } else {
              res.destroy();
            }
          }
          return;
        }
      }

      await this.notFoundHandler(req, res);
    };
  }
}

export function readJsonBody(req: IncomingMessage, maxBytes = 512 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
