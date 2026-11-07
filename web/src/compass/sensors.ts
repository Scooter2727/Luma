import geomagnetism from "geomagnetism";
import type { Fix } from "./orientationEngine";
import { normalize } from "./orientationEngine";

export function watchLocation(
  onFix: (fix: Fix) => void,
  onError: (message: string) => void,
) {
  if (!window.isSecureContext || !navigator.geolocation) {
    onError(
      "Location needs HTTPS and a browser with location support. You can use the compass demo instead.",
    );
    return () => {};
  }
  let id: number | undefined;
  try {
    id = navigator.geolocation.watchPosition(
      (p) =>
        onFix({
          coordinates: [p.coords.longitude, p.coords.latitude],
          accuracy: p.coords.accuracy,
          time: p.timestamp,
          heading: p.coords.heading,
          speed: p.coords.speed,
        }),
      (e) =>
        onError(
          e.code === 1
            ? "Location permission was denied. Turn Compass off and on to retry, or use the demo."
            : "Location is unavailable. Corrections are paused.",
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 },
    );
  } catch {
    onError("Location could not start. Corrections are paused.");
  }
  return () => {
    if (id !== undefined) navigator.geolocation.clearWatch(id);
  };
}
type CompassEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};
export type CompassReading = {
  magnetic: number | null;
  time: number;
  reason: string;
};
export function readCompass(
  e: CompassEvent,
  time: number,
  screenAngle: number,
): CompassReading {
  const invalid = (reason: string): CompassReading => ({
    magnetic: null,
    time,
    reason,
  });
  if (
    screenAngle !== 0 ||
    e.beta === null ||
    e.gamma === null ||
    !Number.isFinite(e.beta) ||
    !Number.isFinite(e.gamma) ||
    Math.abs(e.beta) > 35 ||
    Math.abs(e.gamma) > 35
  )
    return invalid(
      "Hold the phone flat in portrait, with its top pointing forward.",
    );
  if (e.webkitCompassHeading !== undefined) {
    if (
      !Number.isFinite(e.webkitCompassHeading) ||
      e.webkitCompassHeading < 0 ||
      e.webkitCompassHeading >= 360 ||
      !Number.isFinite(e.webkitCompassAccuracy) ||
      e.webkitCompassAccuracy! < 0 ||
      e.webkitCompassAccuracy! > 20
    )
      return invalid(
        "Compass calibration is unreliable. Move away from metal and check the phone’s compass calibration.",
      );
    return { magnetic: e.webkitCompassHeading, time, reason: "" };
  }
  if (
    !e.absolute ||
    e.alpha === null ||
    !Number.isFinite(e.alpha) ||
    e.alpha < 0 ||
    e.alpha >= 360
  )
    return invalid(
      "An absolute compass heading is unavailable on this device.",
    );
  return { magnetic: normalize(360 - e.alpha), time, reason: "" };
}
export function magneticToTrue(
  heading: number,
  fix: Fix,
  date: Date,
): number | null {
  try {
    // WMM2025; do not extrapolate after the model validity window.
    if (date < new Date("2025-01-01") || date >= new Date("2030-01-01"))
      return null;
    const declination = geomagnetism
      .model(date)
      .point([fix.coordinates[1], fix.coordinates[0]]).decl;
    return Number.isFinite(declination)
      ? normalize(heading + declination)
      : null;
  } catch {
    return null;
  }
}
export async function watchCompass(
  onReading: (reading: CompassReading) => void,
): Promise<() => void> {
  const C = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
    requestPermission?: (absolute?: boolean) => Promise<string>;
  };
  if (!window.isSecureContext || !C)
    throw Error(
      "This browser does not provide compass readings. Use the demo on desktop.",
    );
  if (C.requestPermission && (await C.requestPermission(true)) !== "granted")
    throw Error(
      "Compass permission was denied. You can try Find my direction again.",
    );
  let received = false;
  const handler = (event: DeviceOrientationEvent) => {
    if (
      !event.absolute &&
      (event as CompassEvent).webkitCompassHeading === undefined
    )
      return;
    received = true;
    onReading(
      readCompass(event, Date.now(), window.screen.orientation?.angle || 0),
    );
  };
  const timeout = window.setTimeout(() => {
    if (!received)
      onReading({
        magnetic: null,
        time: Date.now(),
        reason:
          "An absolute compass heading is unavailable on this device. You can use the demo instead.",
      });
  }, 8000);
  window.addEventListener("deviceorientation", handler);
  window.addEventListener("deviceorientationabsolute", handler);
  return () => {
    window.clearTimeout(timeout);
    window.removeEventListener("deviceorientation", handler);
    window.removeEventListener("deviceorientationabsolute", handler);
  };
}
export const patterns = {
  drift: [70, 110, 70],
  deviated: [110, 100, 110, 100, 110],
  uncertain: [350],
  aligned: [160],
  realigned: [160],
};
export function vibrate(pattern: number[]) {
  try {
    return (
      typeof navigator.vibrate === "function" && navigator.vibrate(pattern)
    );
  } catch {
    return false;
  }
}
