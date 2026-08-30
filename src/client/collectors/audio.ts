import type { Observation } from "../../shared/schema/types.js";
import { unsupported, observationError, observed } from "../../shared/schema/types.js";
import { djb2Hash } from "../util.js";

/**
 * Audio fingerprinting: render a short buffer through an oscillator + dynamics compressor on
 * an OfflineAudioContext (never routed to speakers) and hash the resulting samples. Small
 * floating-point differences in how different audio stacks/hardware implement the DSP chain
 * produce a measurably different, but deterministic-per-machine, output. See signal catalog.
 * This is the one collector that's genuinely asynchronous end-to-end (the offline render
 * completes via an event), so it returns a Promise — see src/client/index.ts for how it's
 * awaited alongside the synchronous collectors.
 */
export function collectAudio(): Promise<Observation> {
  return new Promise((resolve) => {
    const AudioContextCtor =
      (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;

    if (!AudioContextCtor) {
      resolve(unsupported("browser.audio.fingerprint_hash", "browser.audio", "client", "offline_audio_context"));
      return;
    }

    try {
      const context = new AudioContextCtor(1, 5000, 44100);
      const oscillator = context.createOscillator();
      oscillator.type = "triangle";
      oscillator.frequency.value = 10000;

      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -50;
      compressor.knee.value = 40;
      compressor.ratio.value = 12;
      compressor.attack.value = 0;
      compressor.release.value = 0.25;

      oscillator.connect(compressor);
      compressor.connect(context.destination);
      oscillator.start(0);

      const timeout = setTimeout(() => {
        resolve(observationError("browser.audio.fingerprint_hash", "browser.audio", "client", "offline_audio_context", new Error("render timed out")));
      }, 2000);

      context.startRendering();
      context.oncomplete = (event) => {
        clearTimeout(timeout);
        try {
          const channelData = event.renderedBuffer.getChannelData(0);
          let sum = 0;
          for (let i = 4500; i < channelData.length; i++) {
            sum += Math.abs(channelData[i] ?? 0);
          }
          resolve(
            observed("browser.audio.fingerprint_hash", "browser.audio", "client", "offline_audio_context", djb2Hash(sum.toString()), {
              sampleSum: sum,
            }),
          );
        } catch (err) {
          resolve(observationError("browser.audio.fingerprint_hash", "browser.audio", "client", "offline_audio_context", err));
        }
      };
    } catch (err) {
      resolve(observationError("browser.audio.fingerprint_hash", "browser.audio", "client", "offline_audio_context", err));
    }
  });
}
