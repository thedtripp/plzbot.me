import type { Fingerprint, Observation, DerivedAttribute } from "../../shared/schema/types.js";

export function allObservations(fp: Fingerprint): Observation[] {
  const server = fp.server;
  const client = fp.client;
  return [
    ...server.network,
    ...server.tls,
    ...server.http,
    ...server.http2,
    ...server.clientHints,
    ...(client
      ? [
          ...client.navigator,
          ...client.screen,
          ...client.hardware,
          ...client.graphics,
          ...client.audio,
          ...client.fonts,
          ...client.media,
          ...client.storage,
          ...client.apis,
          ...client.automation,
        ]
      : []),
  ];
}

export function findObservation(fp: Fingerprint, id: string): Observation | undefined {
  return allObservations(fp).find((o) => o.id === id);
}

export function observedValue<T = unknown>(fp: Fingerprint, id: string): T | undefined {
  const o = findObservation(fp, id);
  return o && o.status === "observed" ? (o.normalized as T) : undefined;
}

export function findDerived(fp: Fingerprint, id: string): DerivedAttribute | undefined {
  return fp.derived.find((d) => d.id === id);
}

export function derivedValue<T = unknown>(fp: Fingerprint, id: string): T | undefined {
  const d = findDerived(fp, id);
  return d && d.status === "computed" ? (d.value as T) : undefined;
}
