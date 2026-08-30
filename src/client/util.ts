import { observed, unsupported, observationError, type Observation, type SignalCategory } from "../shared/schema/types.js";

/**
 * Runs `probe`, which should return the value to record (or `undefined`/`null` if the API
 * exists but genuinely has nothing to report). If `probe` throws, the observation is recorded
 * as `status: "error"` rather than silently dropped — every collector in this project follows
 * the "never silently omit" rule from docs/SCHEMA.md, including on the client.
 */
export function safeObserve<T>(
  id: string,
  category: SignalCategory,
  collectionMethod: string,
  probe: () => T,
): Observation {
  try {
    const value = probe();
    return observed(id, category, "client", collectionMethod, value);
  } catch (err) {
    return observationError(id, category, "client", collectionMethod, err);
  }
}

/** For an API that may not exist at all (as opposed to existing but throwing). */
export function observeIfSupported<T>(
  id: string,
  category: SignalCategory,
  collectionMethod: string,
  isSupported: () => boolean,
  probe: () => T,
): Observation {
  try {
    if (!isSupported()) return unsupported(id, category, "client", collectionMethod);
    return observed(id, category, "client", collectionMethod, probe());
  } catch (err) {
    return observationError(id, category, "client", collectionMethod, err);
  }
}

export async function safeObserveAsync<T>(
  id: string,
  category: SignalCategory,
  collectionMethod: string,
  probe: () => Promise<T>,
): Promise<Observation> {
  try {
    const value = await probe();
    return observed(id, category, "client", collectionMethod, value);
  } catch (err) {
    return observationError(id, category, "client", collectionMethod, err);
  }
}

/** Simple, fast, non-cryptographic string hash (djb2) — used to turn large fingerprint
 * surfaces (canvas pixel data, audio sample buffers) into a short comparable value instead of
 * shipping the whole raw surface over the wire. Documented as non-cryptographic; collision
 * resistance is not a design goal here, just compactness. */
export function djb2Hash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
