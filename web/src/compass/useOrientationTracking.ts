import { useEffect, useRef, useState } from "react";
import type { Route } from "../model";
import {
  defaults,
  angleDifference,
  normalize,
  freshFix,
  matchRoute,
  movementCourse,
  OrientationEngine,
} from "./orientationEngine";
import type { EngineConfig, Fix, OrientationResult } from "./orientationEngine";
import {
  magneticToTrue,
  patterns,
  vibrate,
  watchCompass,
  watchLocation,
} from "./sensors";
import type { CompassReading } from "./sensors";

export type Simulation = {
  enabled: boolean;
  gpsHeading: number;
  compassHeading: number;
  expected: number;
  accuracy: number;
  speed: number;
  reliableCompass: boolean;
};
export const labels = {
  ALIGNED: "Direction aligned",
  POSSIBLE_DRIFT: "Possible drift",
  DEVIATED: "Direction differs from route",
  UNCERTAIN: "Direction uncertain",
};
const empty: OrientationResult = {
  state: "UNCERTAIN",
  reason: "Waiting for location readings.",
  difference: null,
  heading: null,
};
export function useOrientationTracking({
  route,
  enabled,
  pointing,
  simulation,
  haptics,
  voice,
  config,
  speak,
}: {
  route: Route;
  enabled: boolean;
  pointing: boolean;
  simulation: Simulation;
  haptics: boolean;
  voice: boolean;
  config: EngineConfig;
  speak: (text: string) => void;
}) {
  const [result, setResult] = useState(empty);
  const [fix, setFix] = useState<Fix | null>(null);
  const [expected, setExpected] = useState<number | null>(null);
  const [compassHeading, setCompassHeading] = useState<number | null>(null);
  const [compassReason, setCompassReason] = useState("");
  const [northReference, setNorthReference] = useState<
    "true" | "magnetic" | null
  >(null);
  const [offRoute, setOffRoute] = useState(false);
  const hapticsAvailable = typeof navigator.vibrate === "function";
  const [vibration, setVibration] = useState(
    hapticsAvailable
      ? "Vibration available; test it on your device."
      : "Vibration is unavailable in this browser. Use spoken feedback or your screen reader instead.",
  );
  const readings = useRef<{
    fix: Fix | null;
    course: number | null;
    compass: CompassReading | null;
    error: string;
  }>({ fix: null, course: null, compass: null, error: "" });
  const sensorCleanup = useRef<(() => void) | null>(null),
    generation = useRef(0);
  const latest = useRef({ simulation, pointing, voice, haptics, speak });
  latest.current = { simulation, pointing, voice, haptics, speak };

  useEffect(() => {
    readings.current = { fix: null, course: null, compass: null, error: "" };
    setFix(null);
    setOffRoute(false);
    setExpected(null);
    setCompassHeading(null);
    setCompassReason("");
    setNorthReference(null);
    setResult(empty);
    generation.current++;
    sensorCleanup.current?.();
    sensorCleanup.current = null;
    if (!enabled || simulation.enabled) return;
    let active = true;
    let history: Fix[] = [];
    const stop = watchLocation(
      (value) => {
        if (!active) return;
        const now = Date.now();
        if (
          !freshFix(value, now, 1000) ||
          (readings.current.fix && value.time <= readings.current.fix.time)
        )
          return;
        history = history.filter((p) => value.time - p.time <= 20000);
        const course = movementCourse(history[0] || null, value);
        history.push(value);
        readings.current = {
          ...readings.current,
          fix: value,
          course,
          error: "",
        };
        setFix(value);
      },
      (message) => {
        if (active) {
          readings.current.error = message;
          readings.current.fix = null;
          readings.current.course = null;
          setFix(null);
        }
      },
    );
    const visibility = () => {
      readings.current.fix = null;
      readings.current.course = null;
      readings.current.compass = null;
      history = [];
      setFix(null);
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      stop();
      generation.current++;
      sensorCleanup.current?.();
      sensorCleanup.current = null;
      document.removeEventListener("visibilitychange", visibility);
      if (typeof navigator.vibrate === "function") navigator.vibrate(0);
    };
  }, [enabled, simulation.enabled, route]);

  async function requestCompass(permission?: Promise<string | null>) {
    const epoch = ++generation.current;
    sensorCleanup.current?.();
    sensorCleanup.current = null;
    readings.current.compass = null;
    try {
      const cleanup = await watchCompass((reading) => {
        if (epoch === generation.current && !document.hidden)
          readings.current.compass = reading;
      }, permission);
      if (epoch !== generation.current) cleanup();
      else sensorCleanup.current = cleanup;
    } catch (error) {
      if (epoch !== generation.current) return;
      readings.current.compass = {
        magnetic: null,
        time: Date.now(),
        reason: (error as Error).message,
      };
    }
  }
  useEffect(() => {
    if (!pointing) {
      sensorCleanup.current?.();
      sensorCleanup.current = null;
      generation.current++;
    }
  }, [pointing]);

  useEffect(() => {
    if (!enabled) return;
    const engine = new OrientationEngine(config);
    let offSince: number | null = null;
    const tick = () => {
      const now = Date.now(),
        { simulation: sim, pointing: find } = latest.current;
      const sensor = readings.current,
        gps = sensor.fix;
      const rawCompass = sensor.compass;
      setCompassReason(rawCompass?.reason || "");
      // The compass face can show magnetic north without a route/GPS fix.
      // Route corrections below still require all location and confidence checks.
      if (
        !sim.enabled &&
        !document.hidden &&
        rawCompass &&
        !rawCompass.reason &&
        rawCompass.magnetic !== null &&
        now - rawCompass.time <= 3000
      ) {
        const corrected =
          gps && freshFix(gps, now)
            ? magneticToTrue(rawCompass.magnetic, gps, new Date(now))
            : null;
        const faceHeading = corrected ?? rawCompass.magnetic;
        setCompassHeading((previous) =>
          previous === null
            ? faceHeading
            : normalize(
                previous + angleDifference(faceHeading, previous) * 0.35,
              ),
        );
        setNorthReference(corrected === null ? "magnetic" : "true");
      } else {
        setCompassHeading(null);
        setNorthReference(null);
      }
      let target: number | null = null,
        heading: number | null = null,
        reason = "",
        token = "",
        sampleTime = now,
        away = false;
      if (sim.enabled) {
        target = sim.expected;
        heading = find ? sim.compassHeading : sim.gpsHeading;
        if (sim.accuracy > 15)
          reason = "GPS accuracy is too low. Corrections are paused.";
        else if (find && !sim.reliableCompass)
          reason = "Compass readings are unreliable. Corrections are paused.";
        else if (!find && sim.speed < 0.65)
          reason =
            "Movement direction is unavailable while stopped or moving slowly. Try Find my direction.";
        token = "demo:" + target + ":" + find;
      } else if (document.hidden)
        reason = "Compass is paused while Luma is in the background.";
      else if (sensor.error) reason = sensor.error;
      else if (!freshFix(gps, now))
        reason = gps
          ? "GPS accuracy is too low or the reading is old. Corrections are paused."
          : "Waiting for a precise location reading.";
      else if (gps) {
        const match = matchRoute(route, gps);
        target = match.bearing;
        token = match.token + ":" + find;
        reason = match.reason;
        away = match.offRoute;
        if (!reason && find) {
          const compass = sensor.compass;
          if (compass?.reason) reason = compass.reason;
          else if (
            !compass ||
            now - compass.time > 3000 ||
            compass.magnetic === null
          )
            reason =
              "Waiting for compass readings. Hold the phone flat, in portrait, and point its top forward.";
          else {
            heading = magneticToTrue(compass.magnetic, gps, new Date(now));
            sampleTime = compass.time;
            if (heading === null)
              reason =
                "Compass north correction is unavailable. Corrections are paused.";
          }
        } else if (!reason) {
          heading = sensor.course;
          sampleTime = gps.time;
          if (heading === null)
            reason =
              "Movement direction is not yet reliable. If stopped, use Find my direction.";
        }
      }
      if (away && !document.hidden) offSince ??= now;
      else offSince = null;
      setOffRoute(offSince !== null && now - offSince >= 8000);
      setExpected(target);
      const next = engine.update({
        now,
        expected: target,
        heading,
        sampleTime,
        token,
        reason,
        pointing: find,
      });
      setResult(next);
      if (next.feedback && !document.hidden) {
        const options = latest.current;
        if (
          options.haptics &&
          hapticsAvailable &&
          !vibrate(patterns[next.feedback])
        )
          setVibration(
            "Vibration could not play. Text and voice feedback still work.",
          );
        if (options.voice) {
          const message =
            next.state === "UNCERTAIN"
              ? "Direction uncertain. " + next.reason
              : next.feedback === "realigned"
                ? "Direction realigned."
                : next.feedback === "aligned"
                  ? "Phone direction approximately aligned. This does not confirm a clear path."
                  : next.state === "DEVIATED"
                    ? find
                      ? `Slowly turn the phone ${next.difference !== null && next.difference > 0 ? "left" : "right"} to match the route direction.`
                      : "Your movement direction differs from the route. Stop somewhere safe and check your direction."
                    : "Possible drift from the route. Check your direction when safe.";
          options.speak((sim.enabled ? "Demo. " : "") + message);
        }
      }
    };
    tick();
    const timer = window.setInterval(tick, 300);
    return () => window.clearInterval(timer);
  }, [enabled, route, config, simulation.enabled, pointing]);
  return {
    result,
    expected,
    compassHeading,
    compassReason,
    northReference,
    fix,
    offRoute,
    vibration,
    hapticsAvailable,
    requestCompass,
    testVibration: () => {
      setVibration(
        vibrate(patterns.realigned)
          ? "Test vibration requested. If you did not feel it, use text or voice feedback."
          : "Vibration could not play. Text and voice feedback still work.",
      );
    },
  };
}
export { defaults };
