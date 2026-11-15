import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { TLSSocket } from "node:tls";
import {
  SCHEMA_VERSION,
  type ClientSignals,
  type Fingerprint,
  type Observation,
} from "../shared/schema/types.js";
import { collectNetwork, collectReverseDns } from "./collectors/network.js";
import { deriveClientSignature } from "./derive/agentSignatures.js";
import { getIp2AsnTable } from "./runtime/ip2asn.js";
import { collectHttp } from "./collectors/http.js";
import { collectHttp2 } from "./collectors/http2.js";
import { collectTls } from "./collectors/tls.js";
import { collectClientHints } from "./collectors/clientHints.js";
import { deriveTls } from "./derive/tlsDerived.js";
import { deriveUserAgent } from "./derive/uaDerived.js";
import { runInterpretation } from "./interpret/engine.js";
import { getConnectionMeta } from "./tls-capture/frontProxy.js";
import { loadConfig, type RuntimeConfig } from "./runtime/config.js";
import { getRequestContext } from "./runtime/requestContext.js";

export interface ClientSubmission {
  navigator?: Observation[];
  screen?: Observation[];
  hardware?: Observation[];
  graphics?: Observation[];
  audio?: Observation[];
  fonts?: Observation[];
  media?: Observation[];
  storage?: Observation[];
  apis?: Observation[];
  automation?: Observation[];
}

async function buildServerHalf(req: IncomingMessage, config: RuntimeConfig): Promise<Pick<Fingerprint, "server" | "request">> {
  const socket = req.socket as TLSSocket;
  const connectionMeta = getConnectionMeta(socket);
  const ctx = getRequestContext(req, config);
  const ip2asn = getIp2AsnTable(config.ip2asnPath, (m) => console.error(`[ip2asn] ${m}`));

  const network = collectNetwork(req, connectionMeta, ctx, ip2asn);
  network.push(await collectReverseDns(ctx.clientIp));

  const server = {
    network,
    tls: collectTls(req, connectionMeta),
    http: collectHttp(req),
    http2: collectHttp2(req),
    clientHints: collectClientHints(req),
  };

  const request = {
    method: req.method ?? "",
    httpVersion: req.httpVersion,
    target: req.url ?? "",
    scheme: ctx.scheme,
    receivedAt: new Date().toISOString(),
  };

  return { server, request };
}

function deriveAll(fp: Pick<Fingerprint, "server">, req: IncomingMessage) {
  const socket = req.socket as TLSSocket;
  const connectionMeta = getConnectionMeta(socket);
  return [...deriveTls(connectionMeta), ...deriveUserAgent(fp.server.http), ...deriveClientSignature(fp.server.http)];
}

function isEmptyClientSignals(payload: ClientSubmission | undefined): boolean {
  if (!payload) return true;
  return (
    !payload.navigator?.length &&
    !payload.screen?.length &&
    !payload.hardware?.length &&
    !payload.graphics?.length &&
    !payload.audio?.length &&
    !payload.fonts?.length &&
    !payload.media?.length &&
    !payload.storage?.length &&
    !payload.apis?.length &&
    !payload.automation?.length
  );
}

let defaultConfig: RuntimeConfig | null = null;

export async function buildFingerprint(
  req: IncomingMessage,
  clientPayload?: ClientSubmission,
  config?: RuntimeConfig,
): Promise<Fingerprint> {
  const cfg = config ?? (defaultConfig ??= loadConfig());
  const { server, request } = await buildServerHalf(req, cfg);

  const client: ClientSignals | null = isEmptyClientSignals(clientPayload)
    ? null
    : {
        status: "submitted",
        navigator: clientPayload?.navigator ?? [],
        screen: clientPayload?.screen ?? [],
        hardware: clientPayload?.hardware ?? [],
        graphics: clientPayload?.graphics ?? [],
        audio: clientPayload?.audio ?? [],
        fonts: clientPayload?.fonts ?? [],
        media: clientPayload?.media ?? [],
        storage: clientPayload?.storage ?? [],
        apis: clientPayload?.apis ?? [],
        automation: clientPayload?.automation ?? [],
      };

  const partial: Fingerprint = {
    schemaVersion: SCHEMA_VERSION,
    fingerprintId: randomUUID(),
    generatedAt: new Date().toISOString(),
    request,
    server,
    client,
    derived: deriveAll({ server }, req),
    interpretation: { assessments: [] },
  };

  partial.interpretation.assessments = runInterpretation(partial);
  return partial;
}
