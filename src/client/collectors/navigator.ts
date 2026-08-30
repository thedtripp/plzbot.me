import type { Observation } from "../../shared/schema/types.js";
import { unsupported, observationError, observed } from "../../shared/schema/types.js";
import { safeObserve, observeIfSupported } from "../util.js";

interface UaDataBrand {
  brand: string;
  version: string;
}
interface NavigatorUAData {
  brands: UaDataBrand[];
  mobile: boolean;
  platform: string;
  getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
}

export function collectNavigator(): Observation[] {
  const nav = navigator;
  const out: Observation[] = [];

  out.push(safeObserve("browser.navigator.user_agent", "browser.navigator", "navigator_property", () => nav.userAgent));
  out.push(safeObserve("browser.navigator.platform", "browser.navigator", "navigator_property", () => nav.platform));
  out.push(safeObserve("browser.navigator.language", "browser.navigator", "navigator_property", () => nav.language));
  out.push(safeObserve("browser.navigator.languages", "browser.navigator", "navigator_property", () => Array.from(nav.languages ?? [])));
  out.push(safeObserve("browser.navigator.vendor", "browser.navigator", "navigator_property", () => nav.vendor));
  out.push(safeObserve("browser.navigator.app_name", "browser.navigator", "navigator_property", () => nav.appName));
  out.push(safeObserve("browser.navigator.app_version", "browser.navigator", "navigator_property", () => nav.appVersion));
  out.push(safeObserve("browser.navigator.app_code_name", "browser.navigator", "navigator_property", () => nav.appCodeName));
  out.push(safeObserve("browser.navigator.cookie_enabled", "browser.navigator", "navigator_property", () => nav.cookieEnabled));
  out.push(
    observeIfSupported(
      "browser.navigator.do_not_track",
      "browser.navigator",
      "navigator_property",
      () => "doNotTrack" in nav,
      () => nav.doNotTrack,
    ),
  );
  out.push(safeObserve("browser.navigator.max_touch_points", "browser.navigator", "navigator_property", () => nav.maxTouchPoints));
  out.push(
    observeIfSupported(
      "browser.navigator.pdf_viewer_enabled",
      "browser.navigator",
      "navigator_property",
      () => "pdfViewerEnabled" in nav,
      () => (nav as unknown as { pdfViewerEnabled: boolean }).pdfViewerEnabled,
    ),
  );
  out.push(
    safeObserve(
      "browser.navigator.timezone",
      "browser.navigator",
      "intl_datetimeformat",
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
  );
  out.push(
    safeObserve(
      "browser.navigator.timezone_offset_minutes",
      "browser.navigator",
      "date_getTimezoneOffset",
      () => new Date().getTimezoneOffset(),
    ),
  );

  // Low-entropy User-Agent Client Hints, mirrored client-side (also observed server-side from
  // the header — see collectors/clientHints.ts server-side — this is the JS-visible view).
  const uaData = (nav as unknown as { userAgentData?: NavigatorUAData }).userAgentData;
  if (!uaData) {
    out.push(unsupported("browser.navigator.ua_data_brands", "browser.navigator", "client", "navigator_userAgentData"));
    out.push(unsupported("browser.navigator.ua_data_mobile", "browser.navigator", "client", "navigator_userAgentData"));
    out.push(unsupported("browser.navigator.ua_data_platform", "browser.navigator", "client", "navigator_userAgentData"));
  } else {
    out.push(observed("browser.navigator.ua_data_brands", "browser.navigator", "client", "navigator_userAgentData", uaData.brands));
    out.push(observed("browser.navigator.ua_data_mobile", "browser.navigator", "client", "navigator_userAgentData", uaData.mobile));
    out.push(observed("browser.navigator.ua_data_platform", "browser.navigator", "client", "navigator_userAgentData", uaData.platform));
  }

  return out;
}

/** navigator.userAgentData.getHighEntropyValues() requires a permission-free but asynchronous
 * call — kept separate from collectNavigator() so the synchronous collectors aren't held up by
 * it (see src/client/index.ts for how the async collectors are awaited alongside the rest). */
export async function collectNavigatorHighEntropy(): Promise<Observation> {
  const uaData = (navigator as unknown as { userAgentData?: NavigatorUAData }).userAgentData;
  if (!uaData?.getHighEntropyValues) {
    return unsupported("browser.navigator.ua_data_high_entropy", "browser.navigator", "client", "navigator_userAgentData_high_entropy");
  }
  try {
    const values = await uaData.getHighEntropyValues([
      "architecture",
      "bitness",
      "model",
      "platformVersion",
      "uaFullVersion",
      "fullVersionList",
      "wow64",
    ]);
    return observed("browser.navigator.ua_data_high_entropy", "browser.navigator", "client", "navigator_userAgentData_high_entropy", values);
  } catch (err) {
    return observationError(
      "browser.navigator.ua_data_high_entropy",
      "browser.navigator",
      "client",
      "navigator_userAgentData_high_entropy",
      err,
    );
  }
}
