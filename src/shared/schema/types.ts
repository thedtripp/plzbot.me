/**
 * Canonical fingerprint schema, v1. See docs/SCHEMA.md for the design rationale.
 * Imported by both the server and the browser collector bundle — this is the one place
 * the shape of a fingerprint is defined.
 */

export const SCHEMA_VERSION = "1.0.0" as const;

export type ObservationStatus =
  | "observed"
  | "unsupported"
  | "unavailable"
  | "not_applicable"
  | "error";

export type SignalCategory =
  | "network"
  | "tls"
  | "http"
  | "http2"
  | "client_hints"
  | "browser.navigator"
  | "browser.screen"
  | "browser.hardware"
  | "browser.graphics"
  | "browser.audio"
  | "browser.fonts"
  | "browser.media"
  | "browser.storage"
  | "browser.apis"
  | "browser.automation";

export interface Observation<Raw = unknown, Normalized = unknown> {
  id: string;
  category: SignalCategory;
  source: "server" | "client";
  collectionMethod: string;
  status: ObservationStatus;
  raw: Raw | null;
  normalized: Normalized | null;
  error?: string;
  observedAt: string;
}

export interface DerivedAttribute<Value = unknown> {
  id: string;
  derivedFrom: string[];
  value: Value | null;
  method: string;
  status: "computed" | "unavailable" | "error";
  error?: string;
}

export type AssessmentCategory =
  | "automation"
  | "consistency"
  | "identifiability"
  | "general";

export type Confidence = "high" | "medium" | "low" | "informational";

export interface AssessmentReference {
  title: string;
  url: string;
}

export interface Assessment {
  id: string;
  category: AssessmentCategory;
  title: string;
  statement: string;
  confidence: Confidence;
  evidence: {
    observationIds: string[];
    derivedIds: string[];
  };
  conflicting?: boolean;
  references?: AssessmentReference[];
}

export interface RequestSummary {
  method: string;
  httpVersion: string;
  target: string;
  scheme: "http" | "https";
  receivedAt: string;
}

export interface ServerSignals {
  network: Observation[];
  tls: Observation[];
  http: Observation[];
  http2: Observation[];
  clientHints: Observation[];
}

export interface ClientSignals {
  status: "submitted";
  navigator: Observation[];
  screen: Observation[];
  hardware: Observation[];
  graphics: Observation[];
  audio: Observation[];
  fonts: Observation[];
  media: Observation[];
  storage: Observation[];
  apis: Observation[];
  automation: Observation[];
}

export interface Fingerprint {
  schemaVersion: typeof SCHEMA_VERSION;
  fingerprintId: string;
  generatedAt: string;
  request: RequestSummary;
  server: ServerSignals;
  client: ClientSignals | null;
  derived: DerivedAttribute[];
  interpretation: {
    assessments: Assessment[];
  };
}

/** Helper for collectors: build an "observed" Observation with less boilerplate. */
export function observed<Raw, Normalized = Raw>(
  id: string,
  category: SignalCategory,
  source: "server" | "client",
  collectionMethod: string,
  raw: Raw,
  normalized?: Normalized,
): Observation<Raw, Normalized> {
  return {
    id,
    category,
    source,
    collectionMethod,
    status: "observed",
    raw,
    normalized: normalized === undefined ? (raw as unknown as Normalized) : normalized,
    observedAt: new Date().toISOString(),
  };
}

export function unavailable(
  id: string,
  category: SignalCategory,
  source: "server" | "client",
  collectionMethod: string,
): Observation {
  return {
    id,
    category,
    source,
    collectionMethod,
    status: "unavailable",
    raw: null,
    normalized: null,
    observedAt: new Date().toISOString(),
  };
}

export function unsupported(
  id: string,
  category: SignalCategory,
  source: "server" | "client",
  collectionMethod: string,
): Observation {
  return {
    id,
    category,
    source,
    collectionMethod,
    status: "unsupported",
    raw: null,
    normalized: null,
    observedAt: new Date().toISOString(),
  };
}

export function notApplicable(
  id: string,
  category: SignalCategory,
  source: "server" | "client",
  collectionMethod: string,
): Observation {
  return {
    id,
    category,
    source,
    collectionMethod,
    status: "not_applicable",
    raw: null,
    normalized: null,
    observedAt: new Date().toISOString(),
  };
}

export function observationError(
  id: string,
  category: SignalCategory,
  source: "server" | "client",
  collectionMethod: string,
  error: unknown,
): Observation {
  return {
    id,
    category,
    source,
    collectionMethod,
    status: "error",
    raw: null,
    normalized: null,
    error: error instanceof Error ? error.message : String(error),
    observedAt: new Date().toISOString(),
  };
}
