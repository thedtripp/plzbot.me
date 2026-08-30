import type { Observation } from "../../shared/schema/types.js";
import { safeObserve } from "../util.js";

/**
 * Established, publicly-documented automation-detection heuristics. None of these are
 * conclusive on their own — see docs (Phase 4) and the server-side interpretation layer
 * (src/server/interpret/rules/automation.ts), which turns these observations into hedged,
 * evidence-cited assessments rather than a single "is a bot" verdict. Collected here as plain
 * observations only; no judgment is made client-side.
 */
export function collectAutomation(): Observation[] {
  const out: Observation[] = [];
  const w = window as unknown as Record<string, unknown>;

  out.push(
    safeObserve("browser.automation.navigator_webdriver", "browser.automation", "navigator_property", () => navigator.webdriver),
  );

  out.push(
    safeObserve(
      "browser.automation.window_chrome_present",
      "browser.automation",
      "window_property_probe",
      () => "chrome" in window,
    ),
  );

  out.push(
    safeObserve(
      "browser.automation.plugins_length",
      "browser.automation",
      "navigator_property",
      () => navigator.plugins?.length ?? 0,
    ),
  );

  out.push(
    safeObserve(
      "browser.automation.languages_length",
      "browser.automation",
      "navigator_property",
      () => navigator.languages?.length ?? 0,
    ),
  );

  out.push(
    safeObserve(
      "browser.automation.outer_dimensions_zero",
      "browser.automation",
      "window_property_probe",
      () => window.outerWidth === 0 && window.outerHeight === 0,
    ),
  );

  out.push(
    safeObserve(
      "browser.automation.phantomjs_markers",
      "browser.automation",
      "window_property_probe",
      () => Boolean(w.callPhantom) || Boolean(w._phantom),
    ),
  );

  out.push(
    safeObserve(
      "browser.automation.selenium_markers",
      "browser.automation",
      "window_property_probe",
      () =>
        Boolean(w.__selenium_unwrapped) ||
        Boolean(w.__webdriver_evaluate) ||
        Boolean(w.__driver_evaluate) ||
        Boolean(document.documentElement.getAttribute("selenium")) ||
        Boolean(document.documentElement.getAttribute("webdriver")) ||
        Boolean(document.documentElement.getAttribute("driver")),
    ),
  );

  out.push(safeObserve("browser.automation.cypress_marker", "browser.automation", "window_property_probe", () => Boolean(w.Cypress)));

  // Classic headless-Chrome permission-state inconsistency (documented in public research on
  // headless detection): in some headless configurations, the Permissions API and the
  // synchronous Notification.permission property disagree about notification permission state.
  out.push(
    safeObserve(
      "browser.automation.notification_permission",
      "browser.automation",
      "notification_api",
      () => (typeof Notification !== "undefined" ? Notification.permission : "unsupported"),
    ),
  );

  return out;
}
