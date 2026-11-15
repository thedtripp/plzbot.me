import http from "node:http";
import http2 from "node:http2";
import fs from "node:fs";
import { createApp } from "./app.js";
import { FrontProxy } from "./tls-capture/frontProxy.js";
import { loadConfig, type RuntimeConfig } from "./runtime/config.js";
import { startAcmeHttpServer, watchCertificates } from "./runtime/acmeHttp.js";

const log = (msg: string) => console.log(msg);

function requireCerts(config: RuntimeConfig): { cert: Buffer; key: Buffer } {
  if (!fs.existsSync(config.certPath) || !fs.existsSync(config.keyPath)) {
    console.error(
      `TLS certificate not found at ${config.certPath} / ${config.keyPath}.\n` +
        `Run 'npm run certs' to generate a local development certificate, set\n` +
        `PLZBOT_TLS_CERT / PLZBOT_TLS_KEY to point at your own, or run with PLZBOT_MODE=http\n` +
        `behind a TLS-terminating proxy (see deploy/README.md).`,
    );
    process.exit(1);
  }
  return { cert: fs.readFileSync(config.certPath), key: fs.readFileSync(config.keyPath) };
}

/**
 * PLZBOT_MODE=http — plain HTTP/1.1 listener for PaaS-style deployments where the platform
 * terminates TLS and proxies to us. The TLS/JA3/JA4 half of the fingerprint is reported as
 * unavailable in this mode; everything else (headers, Client Hints, browser signals) works.
 */
async function startHttpMode(config: RuntimeConfig): Promise<void> {
  const app = createApp(config);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  log(`plzbot.me listening in HTTP mode on http://${config.host}:${config.port}`);
  log(
    config.trustedProxy.hops > 0 || config.trustedProxy.clientIpHeader
      ? `Trusting proxy: hops=${config.trustedProxy.hops} clientIpHeader=${config.trustedProxy.clientIpHeader ?? "(none)"}`
      : `No trusted proxy configured — X-Forwarded-* will be shown but not trusted (set PLZBOT_TRUST_PROXY).`,
  );
  log(`TLS handshake signals (JA3/JA4) are unavailable in this mode; run PLZBOT_MODE=tls to self-terminate TLS.`);

  const shutdown = () => {
    log("\nShutting down...");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * PLZBOT_MODE=tls (default) — we terminate TLS ourselves behind the raw-socket front proxy so
 * the ClientHello is observable (docs/TLS_CAPTURE.md). Optionally also runs a plain-HTTP
 * helper (PLZBOT_HTTP_PORT) for ACME challenges + redirects, and hot-reloads renewed certs.
 */
async function startTlsMode(config: RuntimeConfig): Promise<void> {
  const { cert, key } = requireCerts(config);
  const app = createApp(config);

  const internalServer = http2.createSecureServer({
    cert,
    key,
    allowHTTP1: true,
    ALPNProtocols: ["h2", "http/1.1"],
  });
  internalServer.on("request", app);

  await new Promise<void>((resolve) => internalServer.listen(0, "127.0.0.1", resolve));
  const internalAddress = internalServer.address();
  if (!internalAddress || typeof internalAddress === "string") {
    throw new Error("internal server did not bind to a TCP address");
  }

  const frontProxy = new FrontProxy({
    publicPort: config.port,
    publicHost: config.host,
    internalHost: "127.0.0.1",
    internalPort: internalAddress.port,
    internalTlsServer: internalServer,
    logger: (event, detail) => console.error(`[front-proxy] ${event}`, detail ?? ""),
  });

  await frontProxy.listen();
  log(`plzbot.me fingerprinting engine listening on https://${config.host}:${config.port}`);
  log(`(internal TLS-terminating server on loopback port ${internalAddress.port}, not directly reachable)`);
  if (config.certPath.includes("dev-cert")) {
    log(`Self-signed dev certificate — browsers will show a warning; curl needs -k / --insecure.`);
  }

  let acmeServer: http.Server | null = null;
  if (config.httpPort > 0) acmeServer = startAcmeHttpServer(config, log);
  const stopWatching = watchCertificates(config, (opts) => internalServer.setSecureContext(opts), log);

  const shutdown = async () => {
    log("\nShutting down...");
    stopWatching();
    acmeServer?.close();
    await frontProxy.close();
    internalServer.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.mode === "http") await startHttpMode(config);
  else await startTlsMode(config);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
