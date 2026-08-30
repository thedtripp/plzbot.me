import type { Observation } from "../../shared/schema/types.js";
import { observed } from "../../shared/schema/types.js";

/**
 * Broad browser-API-availability sweep. Individually low-signal, but the *combination* of
 * which of these are present is itself a coarse fingerprinting surface (spec §3: "browser
 * feature/API availability"), and useful educationally as a checklist of "what can this page
 * even ask this browser to do."
 */
const FEATURE_PROBES: Record<string, () => boolean> = {
  webassembly: () => typeof WebAssembly !== "undefined",
  service_worker: () => "serviceWorker" in navigator,
  broadcast_channel: () => typeof BroadcastChannel !== "undefined",
  shared_worker: () => typeof SharedWorker !== "undefined",
  web_worker: () => typeof Worker !== "undefined",
  webgpu: () => "gpu" in navigator,
  notification: () => "Notification" in window,
  bluetooth: () => "bluetooth" in navigator,
  usb: () => "usb" in navigator,
  serial: () => "serial" in navigator,
  hid: () => "hid" in navigator,
  credentials: () => "credentials" in navigator,
  permissions: () => "permissions" in navigator,
  geolocation: () => "geolocation" in navigator,
  clipboard: () => "clipboard" in navigator,
  share: () => "share" in navigator,
  vibrate: () => "vibrate" in navigator,
  wake_lock: () => "wakeLock" in navigator,
  speech_synthesis: () => "speechSynthesis" in window,
  speech_recognition: () => "SpeechRecognition" in window || "webkitSpeechRecognition" in window,
  payment_request: () => "PaymentRequest" in window,
  webxr: () => "xr" in navigator,
  webrtc: () => typeof RTCPeerConnection !== "undefined",
  websocket: () => typeof WebSocket !== "undefined",
  eyedropper: () => "EyeDropper" in window,
  file_system_access: () => "showOpenFilePicker" in window,
  idle_detection: () => "IdleDetector" in window,
  compute_pressure: () => "PressureObserver" in window,
};

export function collectApis(): Observation[] {
  const results: Record<string, boolean> = {};
  for (const [name, probe] of Object.entries(FEATURE_PROBES)) {
    try {
      results[name] = probe();
    } catch {
      results[name] = false;
    }
  }

  return [
    observed("browser.apis.feature_availability", "browser.apis", "client", "feature_probe_sweep", results, {
      availableCount: Object.values(results).filter(Boolean).length,
      totalChecked: Object.keys(results).length,
    }),
  ];
}
