import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Router } from "./http/router.js";
import type { RuntimeConfig } from "./runtime/config.js";
import { getRequestContext } from "./runtime/requestContext.js";
import { PUBLIC_DIR } from "./runtime/paths.js";
import type { FingerprintStore } from "./storage/postgres.js";

/**
 * Private analysis page over the stored fingerprints: GET /admin (HTML) and
 * GET /api/v1/admin/{overview,fingerprints,fingerprint}.
 *
 * Gate: HTTP Basic auth, password = PLZBOT_ADMIN_PASSWORD (any username). With no password
 * configured every admin path answers 404, so the page's existence isn't revealed. The page is
 * served by a route (which wins over the static file handler), never as a public static file.
 * Stored fields (user agents, headers, ...) are attacker-controlled, so the page renders them
 * with textContent only and ships a strict nonce-based Content-Security-Policy.
 */

const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 5 * 60_000;
const failures = new Map<string, { count: number; resetAt: number }>();

function sha256(s: string): Buffer {
  return crypto.createHash("sha256").update(s).digest();
}

function passwordOk(req: IncomingMessage, password: string): boolean {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const given = decoded.slice(decoded.indexOf(":") + 1); // username is ignored
  return crypto.timingSafeEqual(sha256(given), sha256(password));
}

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.statusCode = status;
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-robots-tag", "noindex, nofollow");
  res.setHeader("x-content-type-options", "nosniff");
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  if (typeof body === "string") {
    res.end(body);
  } else {
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  }
}

/** Returns true if the request may proceed; otherwise has already answered it. */
function gate(req: IncomingMessage, res: ServerResponse, config: RuntimeConfig): boolean {
  if (!config.adminPassword) {
    send(res, 404, { error: "Not found" });
    return false;
  }
  const ip = getRequestContext(req, config).clientIp ?? "unknown";
  const now = Date.now();
  const f = failures.get(ip);
  if (f && f.resetAt > now && f.count >= MAX_FAILURES) {
    send(res, 429, { error: "Too many failed attempts. Try again later." }, { "retry-after": String(Math.ceil((f.resetAt - now) / 1000)) });
    return false;
  }
  if (passwordOk(req, config.adminPassword)) {
    failures.delete(ip);
    return true;
  }
  failures.set(ip, !f || f.resetAt <= now ? { count: 1, resetAt: now + FAILURE_WINDOW_MS } : { count: f.count + 1, resetAt: f.resetAt });
  send(res, 401, { error: "Authentication required" }, { "www-authenticate": 'Basic realm="plzbot admin", charset="UTF-8"' });
  return false;
}

// One pass over the window; every report selects from this.
const RECENT = `
WITH recent AS (
  SELECT id, seen_at, kind, host(client_ip) AS ip, ja4,
    (SELECT o->>'raw' FROM jsonb_array_elements(doc->'server'->'http') o WHERE o->>'id' = 'http.headers.user_agent' LIMIT 1) AS ua,
    (SELECT d->'value'->>'name' FROM jsonb_array_elements(doc->'derived') d WHERE d->>'id' = 'derived.client_signature' LIMIT 1) AS agent,
    (SELECT d->'value'->>'category' FROM jsonb_array_elements(doc->'derived') d WHERE d->>'id' = 'derived.client_signature' LIMIT 1) AS agent_category,
    (SELECT o->'normalized'->>0 FROM jsonb_array_elements(doc->'server'->'network') o WHERE o->>'id' = 'network.reverse_dns' LIMIT 1) AS hostname,
    CASE WHEN jsonb_typeof(doc->'interpretation'->'assessments') = 'array' THEN doc->'interpretation'->'assessments' ELSE '[]'::jsonb END AS assessments
  FROM fingerprints
  WHERE seen_at >= now() - make_interval(days => $1)
)`;

const intParam = (v: string | null, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
};

function needStore(store: FingerprintStore | null, res: ServerResponse): store is FingerprintStore {
  if (store) return true;
  send(res, 503, { error: "Storage is not configured (set PLZBOT_DATABASE_URL)." });
  return false;
}

export function registerAdminRoutes(router: Router, config: RuntimeConfig, store: FingerprintStore | null): void {
  const htmlPath = path.join(PUBLIC_DIR, "admin.html");

  const page = (req: IncomingMessage, res: ServerResponse) => {
    if (!gate(req, res, config)) return;
    const nonce = crypto.randomBytes(16).toString("base64");
    const html = fs.readFileSync(htmlPath, "utf8").replaceAll("__NONCE__", nonce);
    send(res, 200, html, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    });
  };
  router.get("/admin", page);
  router.get("/admin.html", page);

  router.get("/api/v1/admin/overview", async (req, res) => {
    if (!gate(req, res, config) || !needStore(store, res)) return;
    const days = intParam(new URL(req.url ?? "", "http://x").searchParams.get("days"), 7, 1, 365);
    const [totals, daily, topJa4, topAgents, topIps, rules] = await Promise.all([
      store.query(
        `SELECT (SELECT count(*)::int FROM fingerprints) AS all_time,
                pg_total_relation_size('fingerprints')::bigint AS table_bytes,
                count(*)::int AS total, count(DISTINCT ip)::int AS ips, count(DISTINCT ja4)::int AS ja4s
         FROM (${RECENT} SELECT * FROM recent) r`,
        [days],
      ),
      store.query(`${RECENT} SELECT to_char(seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, kind, count(*)::int AS n FROM recent GROUP BY 1, 2 ORDER BY 1`, [days]),
      store.query(
        `${RECENT} SELECT ja4, count(*)::int AS n, count(DISTINCT ip)::int AS ips, mode() WITHIN GROUP (ORDER BY ua) AS ua
         FROM recent WHERE ja4 IS NOT NULL GROUP BY ja4 ORDER BY n DESC LIMIT 15`,
        [days],
      ),
      store.query(
        `${RECENT} SELECT coalesce(agent, '(none)') AS agent, coalesce(agent_category, '(none)') AS category, count(*)::int AS n
         FROM recent GROUP BY 1, 2 ORDER BY n DESC LIMIT 15`,
        [days],
      ),
      store.query(
        `${RECENT} SELECT ip, count(*)::int AS n, count(DISTINCT ja4)::int AS ja4s, max(seen_at) AS last_seen, mode() WITHIN GROUP (ORDER BY hostname) AS hostname, mode() WITHIN GROUP (ORDER BY ua) AS ua
         FROM recent WHERE ip IS NOT NULL GROUP BY ip ORDER BY n DESC LIMIT 15`,
        [days],
      ),
      store.query(
        `${RECENT} SELECT a->>'id' AS id, a->>'confidence' AS confidence, count(*)::int AS n
         FROM recent, jsonb_array_elements(assessments) a GROUP BY 1, 2 ORDER BY n DESC LIMIT 20`,
        [days],
      ),
    ]);
    send(res, 200, { days, totals: totals[0], daily, topJa4, topAgents, topIps, rules });
  });

  router.get("/api/v1/admin/fingerprints", async (req, res) => {
    if (!gate(req, res, config) || !needStore(store, res)) return;
    const q = new URL(req.url ?? "", "http://x").searchParams;
    const days = intParam(q.get("days"), 7, 1, 365);
    const limit = intParam(q.get("limit"), 50, 1, 200);
    const offset = intParam(q.get("offset"), 0, 0, 1_000_000);
    const params: unknown[] = [days];
    const where: string[] = [];
    const add = (cond: (i: number) => string, value: unknown) => {
      params.push(value);
      where.push(cond(params.length));
    };
    const kind = q.get("kind");
    if (kind) add((i) => `kind = $${i}`, kind);
    const ip = q.get("ip");
    if (ip) {
      if (!net.isIP(ip)) return send(res, 400, { error: "ip must be a valid address" });
      add((i) => `ip = $${i}`, ip);
    }
    const ja4 = q.get("ja4");
    if (ja4) add((i) => `ja4 = $${i}`, ja4);
    const agent = q.get("agent");
    if (agent) add((i) => `agent = $${i}`, agent);
    const host = q.get("host");
    if (host) add((i) => `hostname ILIKE '%' || $${i} || '%' ESCAPE '\\'`, host.replace(/[\\%_]/g, "\\$&"));
    const text = q.get("q");
    if (text) add((i) => `ua ILIKE '%' || $${i} || '%' ESCAPE '\\'`, text.replace(/[\\%_]/g, "\\$&"));
    params.push(limit + 1, offset);
    const rows = await store.query(
      `${RECENT} SELECT id, seen_at, kind, ip, hostname, ja4, ua, agent, agent_category, jsonb_array_length(assessments)::int AS rules
       FROM recent ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY seen_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    send(res, 200, { rows: rows.slice(0, limit), hasMore: rows.length > limit });
  });

  router.get("/api/v1/admin/fingerprint", async (req, res) => {
    if (!gate(req, res, config) || !needStore(store, res)) return;
    const id = new URL(req.url ?? "", "http://x").searchParams.get("id") ?? "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return send(res, 400, { error: "id must be a uuid" });
    const rows = await store.query(`SELECT id, seen_at, kind, host(client_ip) AS ip, doc FROM fingerprints WHERE id = $1`, [id]);
    if (rows.length === 0) return send(res, 404, { error: "Not found" });
    send(res, 200, rows[0]);
  });
}
