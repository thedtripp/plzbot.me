import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { RuntimeConfig } from "./config.js";

/**
 * Plain-HTTP companion listener used only in TLS mode on a real deployment (PLZBOT_HTTP_PORT=80):
 *   - serves `/.well-known/acme-challenge/<token>` from the ACME webroot so certbot (or any
 *     ACME client) can complete HTTP-01 validation without us embedding an ACME client, and
 *   - 301-redirects everything else to https://, so a bare `http://host` lands on the demo.
 * Nothing on this listener is fingerprinted; the point of the project is the TLS listener.
 */
export function startAcmeHttpServer(config: RuntimeConfig, log: (msg: string) => void): http.Server {
  const challengeDir = path.resolve(config.acmeWebroot, ".well-known", "acme-challenge");

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://placeholder.invalid");
    const m = url.pathname.match(/^\/\.well-known\/acme-challenge\/([A-Za-z0-9_-]+)$/);
    if (m && m[1]) {
      const file = path.join(challengeDir, m[1]);
      if (file.startsWith(challengeDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(fs.readFileSync(file));
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("challenge not found\n");
      return;
    }

    const hostHeader = (req.headers.host ?? "").split(":")[0];
    const origin = config.publicOrigin ?? (hostHeader ? `https://${hostHeader}${config.port === 443 ? "" : `:${config.port}`}` : null);
    if (!origin) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("This port only serves ACME challenges; use https://\n");
      return;
    }
    res.writeHead(301, { location: origin + (req.url ?? "/") });
    res.end();
  });

  server.listen(config.httpPort, config.host, () => {
    log(`plain-HTTP helper listening on http://${config.host}:${config.httpPort} (ACME webroot: ${config.acmeWebroot}; everything else redirects to https)`);
  });
  return server;
}

/**
 * Polls the certificate files and hot-swaps them into the running TLS server when they change
 * (certbot renews in place; no restart needed). Polling rather than fs.watch because the cert
 * directory is typically a bind mount / symlink farm where inotify semantics are unreliable.
 */
export function watchCertificates(
  config: RuntimeConfig,
  apply: (opts: { cert: Buffer; key: Buffer }) => void,
  log: (msg: string) => void,
  intervalMs = 60_000,
): () => void {
  let last = "";
  const check = () => {
    try {
      const cert = fs.readFileSync(config.certPath);
      const key = fs.readFileSync(config.keyPath);
      const sig = `${cert.length}:${key.length}:${fs.statSync(config.certPath).mtimeMs}`;
      if (last && sig !== last) {
        apply({ cert, key });
        log(`TLS certificate reloaded from ${config.certPath}`);
      }
      last = sig;
    } catch (err) {
      log(`certificate watch: ${(err as Error).message}`);
    }
  };
  check();
  const timer = setInterval(check, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
