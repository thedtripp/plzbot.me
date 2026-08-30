import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router, readJsonBody, type Handler } from "./http/router.js";
import { serveStatic } from "./http/staticFiles.js";
import { buildFingerprint, type ClientSubmission } from "./fingerprint.js";
import { ACCEPT_CH_VALUE } from "./collectors/clientHints.js";
import { SIGNAL_CATALOG } from "./interpret/catalog.js";
import { SCHEMA_VERSION } from "../shared/schema/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "..", "public");

function json(res: Parameters<Handler>[1], status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function createApp(): Handler {
  const router = new Router();
  const staticHandler = serveStatic(publicDir);

  router.get("/api/v1/fingerprint", (req, res) => {
    const fp = buildFingerprint(req);
    json(res, 200, fp);
  });

  router.post("/api/v1/fingerprint/client", async (req, res) => {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      json(res, 400, { error: `Invalid JSON body: ${(err as Error).message}` });
      return;
    }
    if (body !== undefined && (typeof body !== "object" || body === null)) {
      json(res, 400, { error: "Request body must be a JSON object of client observation arrays." });
      return;
    }
    const fp = buildFingerprint(req, body as ClientSubmission | undefined);
    json(res, 200, fp);
  });

  router.get("/api/v1/signals", (_req, res) => {
    json(res, 200, { schemaVersion: SCHEMA_VERSION, signals: SIGNAL_CATALOG });
  });

  router.get("/api/v1", (_req, res) => {
    json(res, 200, {
      schemaVersion: SCHEMA_VERSION,
      endpoints: [
        { method: "GET", path: "/api/v1/fingerprint", description: "Server-observed fingerprint for the current request." },
        { method: "POST", path: "/api/v1/fingerprint/client", description: "Submit browser-collected observations; returns the combined fingerprint." },
        { method: "GET", path: "/api/v1/signals", description: "Educational catalog of known signal ids." },
      ],
      documentation: "See docs/API.md in the repository.",
    });
  });

  router.notFound((req, res) => {
    if (req.method === "GET") {
      staticHandler(req, res);
      return;
    }
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Not found" }));
  });

  const routed = router.handler();

  // Ask supporting browsers to attach high-entropy Client Hints on subsequent requests.
  // See docs/ARCHITECTURE.md / collectors/clientHints.ts for why the *first* request in a
  // fresh connection legitimately won't have them yet.
  return (req, res) => {
    res.setHeader("Accept-CH", ACCEPT_CH_VALUE);
    res.setHeader("Critical-CH", ACCEPT_CH_VALUE);
    res.setHeader("Vary", "Accept-CH");
    return routed(req, res);
  };
}
