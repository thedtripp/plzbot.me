import http2 from "node:http2";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { FrontProxy } from "./tls-capture/frontProxy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const PUBLIC_PORT = Number(process.env.PLZBOT_PORT ?? 8443);
const PUBLIC_HOST = process.env.PLZBOT_HOST ?? "127.0.0.1";
const CERT_PATH = process.env.PLZBOT_TLS_CERT ?? path.join(repoRoot, "certs", "dev-cert.pem");
const KEY_PATH = process.env.PLZBOT_TLS_KEY ?? path.join(repoRoot, "certs", "dev-key.pem");

function requireCerts(): { cert: Buffer; key: Buffer } {
  if (!fs.existsSync(CERT_PATH) || !fs.existsSync(KEY_PATH)) {
    console.error(
      `TLS certificate not found at ${CERT_PATH} / ${KEY_PATH}.\n` +
        `Run 'npm run certs' to generate a local development certificate, or set\n` +
        `PLZBOT_TLS_CERT / PLZBOT_TLS_KEY to point at your own.`,
    );
    process.exit(1);
  }
  return { cert: fs.readFileSync(CERT_PATH), key: fs.readFileSync(KEY_PATH) };
}

async function main(): Promise<void> {
  const { cert, key } = requireCerts();
  const app = createApp();

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
    publicPort: PUBLIC_PORT,
    publicHost: PUBLIC_HOST,
    internalHost: "127.0.0.1",
    internalPort: internalAddress.port,
    internalTlsServer: internalServer,
    logger: (event, detail) => console.error(`[front-proxy] ${event}`, detail ?? ""),
  });

  await frontProxy.listen();
  console.log(`plzbot.me fingerprinting engine listening on https://${PUBLIC_HOST}:${PUBLIC_PORT}`);
  console.log(`(internal TLS-terminating server on loopback port ${internalAddress.port}, not directly reachable)`);
  console.log(`Self-signed dev certificate — browsers will show a warning; curl needs -k / --insecure.`);

  const shutdown = async () => {
    console.log("\nShutting down...");
    await frontProxy.close();
    internalServer.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
