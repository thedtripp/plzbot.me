import type { Observation } from "../../shared/schema/types.js";
import { observed, unsupported, observationError } from "../../shared/schema/types.js";
import { safeObserve } from "../util.js";

function probeStorage(kind: "localStorage" | "sessionStorage"): boolean {
  const testKey = "__plzbot_probe__";
  try {
    const storage = window[kind];
    storage.setItem(testKey, "1");
    storage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

export function collectStorage(): Observation[] {
  const out: Observation[] = [];

  out.push(safeObserve("browser.storage.local_storage_available", "browser.storage", "storage_probe", () => probeStorage("localStorage")));
  out.push(safeObserve("browser.storage.session_storage_available", "browser.storage", "storage_probe", () => probeStorage("sessionStorage")));
  out.push(
    safeObserve(
      "browser.storage.indexed_db_available",
      "browser.storage",
      "feature_probe",
      () => typeof indexedDB !== "undefined",
    ),
  );
  out.push(
    safeObserve(
      "browser.storage.cache_api_available",
      "browser.storage",
      "feature_probe",
      () => "caches" in window,
    ),
  );
  out.push(
    safeObserve(
      "browser.storage.service_worker_available",
      "browser.storage",
      "feature_probe",
      () => "serviceWorker" in navigator,
    ),
  );

  return out;
}

export async function collectStorageEstimate(): Promise<Observation> {
  if (!navigator.storage?.estimate) {
    return unsupported("browser.storage.estimate", "browser.storage", "client", "navigator_storage_estimate");
  }
  try {
    const estimate = await navigator.storage.estimate();
    return observed("browser.storage.estimate", "browser.storage", "client", "navigator_storage_estimate", estimate);
  } catch (err) {
    return observationError("browser.storage.estimate", "browser.storage", "client", "navigator_storage_estimate", err);
  }
}
