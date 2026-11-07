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
  guidanceReason?: string;
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
  const flat = !(
    e.beta === null ||
    e.gamma === null ||
    !Number.isFinite(e.beta) ||
    !Number.isFinite(e.gamma) ||
    Math.abs(e.beta) > 35 ||
    Math.abs(e.gamma) > 35
  );
  if (screenAngle !== 0)
    return invalid(
      "Rotate the phone to portrait, with its top pointing forward.",
    );
  if (e.webkitCompassHeading !== undefined) {
    if (
      !Number.isFinite(e.webkitCompassHeading) ||
      e.webkitCompassHeading < 0 ||
      e.webkitCompassHeading >= 360
    )
      return invalid(
        "The iPhone compass has not supplied a valid heading yet. Move the phone gently.",
      );
    const accuracy = e.webkitCompassAccuracy;
    if (Number.isFinite(accuracy) && accuracy! < 0)
      return invalid(
        "Compass calibration is unreliable. Move away from metal and check the phone’s compass calibration.",
      );
    // Safari supplies its own heading. Tilt/unknown accuracy should pause route
    // corrections, rather than throwing away the compass display entirely.
    const guidanceReason = !Number.isFinite(accuracy)
      ? "Compass accuracy is unavailable. Alignment feedback is paused."
      : accuracy! > 20
        ? "Compass accuracy is low. Move away from metal; alignment feedback is paused."
        : !flat
          ? "Hold the phone flatter for alignment feedback."
          : undefined;
    return {
      magnetic: e.webkitCompassHeading,
      time,
      reason: "",
      guidanceReason,
    };
  }
  if (!flat)
    return invalid(
      "Hold the phone flat in portrait, with its top pointing forward.",
    );
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
// Call during the opening tap, before rendering/mounting the Compass screen.
// Resolve errors as text so a pending system prompt cannot reject unhandled.
export async function requestCompassAccess(): Promise<string | null> {
  const C = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
    requestPermission?: (absolute?: boolean) => Promise<string>;
  };
  if (!window.isSecureContext)
    return "Compass access needs HTTPS. Open the secure deployed Luma website.";
  if (!C)
    return "This browser does not provide compass readings. Use the demo on desktop.";
  try {
    if (C.requestPermission && (await C.requestPermission(true)) !== "granted")
      return "Compass permission was denied. Go Back and reopen Compass to allow Motion and Orientation access.";
    return null;
  } catch {
    return "Compass permission could not be obtained. Go Back and reopen Compass to retry.";
  }
}
export async function watchCompass(
  onReading: (reading: CompassReading) => void,
  permission: Promise<string | null> = requestCompassAccess(),
): Promise<() => void> {
  const error = await permission;
  if (error) throw Error(error);
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
          "No compass readings arrived. Move the phone gently. If this continues, go Back and reopen Compass to allow Motion and Orientation access.",
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
