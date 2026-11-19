import { Router, readJsonBody, type Handler } from "./http/router.js";
import { serveStatic } from "./http/staticFiles.js";
import { buildFingerprint, type ClientSubmission } from "./fingerprint.js";
import { ACCEPT_CH_VALUE } from "./collectors/clientHints.js";
import { SIGNAL_CATALOG } from "./interpret/catalog.js";
import { SCHEMA_VERSION } from "../shared/schema/types.js";
import { PUBLIC_DIR } from "./runtime/paths.js";
import { loadConfig, type RuntimeConfig } from "./runtime/config.js";
import type { FingerprintStore } from "./storage/postgres.js";
import { registerAdminRoutes } from "./admin.js";
import { parseTrace } from "./behavior/validate.js";
import { computeFeatures } from "./behavior/features.js";
import { assess } from "./behavior/rules.js";
import { RecaptchaAssessor } from "./recaptcha/assess.js";
import { getRequestContext } from "./runtime/requestContext.js";

function json(res: Parameters<Handler>[1], status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function createApp(
  config: RuntimeConfig = loadConfig(),
  store: FingerprintStore | null = null,
  /** Injectable so tests can fake Google; by default built from the config (null when reCAPTCHA is off). */
  recaptcha: RecaptchaAssessor | null = config.recaptcha ? new RecaptchaAssessor(config.recaptcha) : null,
): Handler {
  const router = new Router();
  const staticHandler = serveStatic(PUBLIC_DIR);

  router.get("/healthz", (_req, res) => {
    json(res, 200, { ok: true, mode: config.mode, schemaVersion: SCHEMA_VERSION });
  });

  router.get("/api/v1/fingerprint", async (req, res) => {
    const fp = await buildFingerprint(req, undefined, config);
    store?.save(fp, "api_get");
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
    const fp = await buildFingerprint(req, body as ClientSubmission | undefined, config);
    store?.save(fp, "client_submit");
    json(res, 200, fp);
  });

  router.get("/behavior", (req, res) => {
    req.url = "/behavior.html" + (req.url ?? "").slice("/behavior".length);
    staticHandler(req, res);
  });

  // Public, non-secret settings for the optional Google reCAPTCHA score. The page loads Google's script only when enabled.
  router.get("/api/v1/recaptcha", (_req, res) => {
    json(res, 200, recaptcha ? { enabled: true, ...recaptcha.clientConfig() } : { enabled: false });
  });

  router.post("/api/v1/behavior", async (req, res) => {
    let body: unknown;
    let trace;
    try {
      body = await readJsonBody(req);
      trace = parseTrace(body);
    } catch (err) {
      json(res, 400, { error: `Invalid behavior trace: ${(err as Error).message}` });
      return;
    }
    const features = computeFeatures(trace);
    const verdict = { ...assess(features), features };
    if (!recaptcha) {
      json(res, 200, verdict);
      return;
    }
    // A separate signal beside the verdict: it never changes the verdict above.
    const result = await recaptcha.assess({
      token: (body as { recaptchaToken?: unknown }).recaptchaToken,
      clientIp: getRequestContext(req, config).clientIp,
      userAgent: req.headers["user-agent"],
    });
    json(res, 200, { ...verdict, recaptcha: result });
  });

  registerAdminRoutes(router, config, store);

  router.get("/api/v1/signals", (_req, res) => {
    json(res, 200, { schemaVersion: SCHEMA_VERSION, signals: SIGNAL_CATALOG });
  });

  router.get("/api/v1", (_req, res) => {
    json(res, 200, {
      schemaVersion: SCHEMA_VERSION,
      endpoints: [
        { method: "GET", path: "/api/v1/fingerprint", description: "Server-observed fingerprint for the current request." },
        { method: "POST", path: "/api/v1/fingerprint/client", description: "Submit browser-collected observations; returns the combined fingerprint." },
        { method: "POST", path: "/api/v1/behavior", description: "Submit an interaction trace ({trace:{events,...}}); returns a hedged human/automated verdict with cited evidence." },
        { method: "GET", path: "/api/v1/recaptcha", description: "Whether the optional Google reCAPTCHA score is enabled on this deployment, and the public site key the page needs." },
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
    // Also record page requests, so a crawler or agent that never runs JS still leaves a record.
    if (store && req.method === "GET" && ["/", "/index.html", "/behavior", "/behavior.html"].includes((req.url ?? "").split("?")[0]!)) {
      buildFingerprint(req, undefined, config).then((fp) => store.save(fp, "page_view"), () => {});
    }
    res.setHeader("Accept-CH", ACCEPT_CH_VALUE);
    res.setHeader("Critical-CH", ACCEPT_CH_VALUE);
    res.setHeader("Vary", "Accept-CH");
    return routed(req, res);
  };
}
