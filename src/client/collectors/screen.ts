import type { Observation } from "../../shared/schema/types.js";
import { safeObserve, observeIfSupported } from "../util.js";

export function collectScreen(): Observation[] {
  const out: Observation[] = [];

  out.push(safeObserve("browser.screen.width", "browser.screen", "screen_property", () => screen.width));
  out.push(safeObserve("browser.screen.height", "browser.screen", "screen_property", () => screen.height));
  out.push(safeObserve("browser.screen.avail_width", "browser.screen", "screen_property", () => screen.availWidth));
  out.push(safeObserve("browser.screen.avail_height", "browser.screen", "screen_property", () => screen.availHeight));
  out.push(safeObserve("browser.screen.color_depth", "browser.screen", "screen_property", () => screen.colorDepth));
  out.push(safeObserve("browser.screen.pixel_depth", "browser.screen", "screen_property", () => screen.pixelDepth));
  out.push(safeObserve("browser.screen.device_pixel_ratio", "browser.screen", "window_property", () => window.devicePixelRatio));
  out.push(
    observeIfSupported(
      "browser.screen.orientation_type",
      "browser.screen",
      "screen_orientation_api",
      () => "orientation" in screen,
      () => screen.orientation?.type,
    ),
  );
  out.push(
    observeIfSupported(
      "browser.screen.is_extended",
      "browser.screen",
      "screen_isExtended",
      () => "isExtended" in screen,
      () => (screen as unknown as { isExtended?: boolean }).isExtended,
    ),
  );
  out.push(
    safeObserve("browser.screen.inner_dimensions", "browser.screen", "window_property", () => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    })),
  );

  return out;
}
