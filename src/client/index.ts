import type { Fingerprint, Observation } from "../shared/schema/types.js";
import { collectNavigator, collectNavigatorHighEntropy } from "./collectors/navigator.js";
import { collectScreen } from "./collectors/screen.js";
import { collectHardware } from "./collectors/hardware.js";
import { collectGraphics } from "./collectors/graphics.js";
import { collectAudio } from "./collectors/audio.js";
import { collectFonts } from "./collectors/fonts.js";
import { collectMedia } from "./collectors/media.js";
import { collectStorage, collectStorageEstimate } from "./collectors/storage.js";
import { collectApis } from "./collectors/apis.js";
import { collectAutomation } from "./collectors/automation.js";

export interface CollectedClientSignals {
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

async function collectAll(): Promise<CollectedClientSignals> {
  const [highEntropy, audioFp, storageEstimate] = await Promise.all([
    collectNavigatorHighEntropy(),
    collectAudio(),
    collectStorageEstimate(),
  ]);

  return {
    navigator: [...collectNavigator(), highEntropy],
    screen: collectScreen(),
    hardware: collectHardware(),
    graphics: collectGraphics(),
    audio: [audioFp],
    fonts: collectFonts(),
    media: collectMedia(),
    storage: [...collectStorage(), storageEstimate],
    apis: collectApis(),
    automation: collectAutomation(),
  };
}

const FINGERPRINT_EVENT = "plzbot:fingerprint";

declare global {
  interface Window {
    __plzbotFingerprint?: Fingerprint;
    __plzbotCollect?: () => Promise<Fingerprint>;
  }
}

async function run(): Promise<Fingerprint> {
  const signals = await collectAll();
  const response = await fetch("/api/v1/fingerprint/client", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signals),
  });
  const fingerprint = (await response.json()) as Fingerprint;
  window.__plzbotFingerprint = fingerprint;
  window.dispatchEvent(new CustomEvent(FINGERPRINT_EVENT, { detail: fingerprint }));
  return fingerprint;
}

window.__plzbotCollect = run;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void run());
} else {
  void run();
}
