#!/usr/bin/env node
// Generates a self-signed TLS certificate for local development only.
// Not for production use — see docs/ARCHITECTURE.md for deployment notes.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "certs");
mkdirSync(dir, { recursive: true });

const keyPath = path.join(dir, "dev-key.pem");
const certPath = path.join(dir, "dev-cert.pem");

if (existsSync(keyPath) && existsSync(certPath)) {
  console.log("Dev certs already exist at certs/. Delete them to regenerate.");
  process.exit(0);
}

execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "365",
    "-nodes",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ],
  { stdio: "inherit" },
);

console.log(`Generated dev certificate at ${certPath}`);
