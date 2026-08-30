import type { Observation } from "../../shared/schema/types.js";
import { safeObserve, observeIfSupported } from "../util.js";

interface NetworkInformation {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

export function collectHardware(): Observation[] {
  const out: Observation[] = [];

  out.push(
    observeIfSupported(
      "browser.hardware.concurrency",
      "browser.hardware",
      "navigator_property",
      () => "hardwareConcurrency" in navigator,
      () => navigator.hardwareConcurrency,
    ),
  );

  out.push(
    observeIfSupported(
      "browser.hardware.device_memory_gb",
      "browser.hardware",
      "navigator_property",
      () => "deviceMemory" in navigator,
      () => (navigator as unknown as { deviceMemory?: number }).deviceMemory,
    ),
  );

  out.push(
    observeIfSupported(
      "browser.hardware.touch_support",
      "browser.hardware",
      "feature_probe",
      () => true,
      () => ({
        maxTouchPoints: navigator.maxTouchPoints,
        ontouchstart: "ontouchstart" in window,
        touchEvent: typeof TouchEvent !== "undefined",
      }),
    ),
  );

  const conn = (navigator as unknown as { connection?: NetworkInformation }).connection;
  out.push(
    conn
      ? safeObserve("browser.hardware.network_information", "browser.hardware", "navigator_connection", () => ({
          effectiveType: conn.effectiveType,
          downlink: conn.downlink,
          rtt: conn.rtt,
          saveData: conn.saveData,
        }))
      : observeIfSupported(
          "browser.hardware.network_information",
          "browser.hardware",
          "navigator_connection",
          () => false,
          () => null,
        ),
  );

  out.push(
    observeIfSupported(
      "browser.hardware.battery_api_present",
      "browser.hardware",
      "feature_probe",
      () => true,
      () => "getBattery" in navigator,
    ),
  );

  return out;
}
