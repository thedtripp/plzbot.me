import type { Assessment, Fingerprint } from "../../../shared/schema/types.js";
import { findObservation } from "../lookup.js";

/**
 * Signals research has generally found to carry high entropy (i.e. to narrow the set of
 * possible devices a lot) when combined. Listed here with references rather than asserting a
 * number for *this* fingerprint — the MVP has no population dataset to compute actual entropy
 * against (see docs/SCHEMA.md "Extensibility rules" #6 for how that would plug in later).
 */
const HIGH_ENTROPY_SIGNAL_IDS: Array<{ id: string; label: string }> = [
  { id: "browser.graphics.canvas_hash", label: "Canvas rendering hash" },
  { id: "browser.graphics.webgl_renderer", label: "WebGL renderer string" },
  { id: "browser.audio.fingerprint_hash", label: "AudioContext fingerprint" },
  { id: "browser.fonts.detected", label: "Detected font list" },
  { id: "derived.ja3_hash", label: "TLS JA3 hash" },
  { id: "derived.ja4", label: "TLS JA4 fingerprint" },
  { id: "client_hints.sec_ch_ua_full_version_list", label: "Full browser version list (high-entropy Client Hint)" },
];

export function identifiabilityRules(fp: Fingerprint): Assessment[] {
  const present = HIGH_ENTROPY_SIGNAL_IDS.filter((s) => {
    const obs = findObservation(fp, s.id);
    if (obs) return obs.status === "observed";
    const derived = fp.derived.find((d) => d.id === s.id);
    return derived?.status === "computed";
  });

  if (present.length === 0) return [];

  return [
    {
      id: "identifiability.high_entropy_signals_present",
      category: "identifiability",
      title: `${present.length} commonly high-entropy signal${present.length === 1 ? "" : "s"} present in this fingerprint`,
      statement: `This fingerprint includes ${present.map((s) => s.label).join(", ")}. Fingerprinting research (see references) has repeatedly found signals like these — especially in combination — to substantially narrow the set of devices consistent with a given fingerprint, in some studies to a small handful or a single device out of hundreds of thousands sampled. This is a general research finding about these *categories* of signal, not a computed uniqueness score for this specific fingerprint — no population dataset is available to this MVP to compute one (see docs/SCHEMA.md).`,
      confidence: "informational",
      evidence: { observationIds: present.map((s) => s.id).filter((id) => findObservation(fp, id)), derivedIds: present.map((s) => s.id).filter((id) => !findObservation(fp, id)) },
      references: [
        {
          title: "EFF Panopticlick / Cover Your Tracks research",
          url: "https://coveryourtracks.eff.org/",
        },
        {
          title: "Eckersley, 'How Unique Is Your Web Browser?' (PETS 2010)",
          url: "https://panopticlick.eff.org/static/browser-uniqueness.pdf",
        },
      ],
    },
  ];
}
