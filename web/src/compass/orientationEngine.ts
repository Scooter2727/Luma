import type { Coord, Route } from "../model";

export const normalize = (angle: number) => ((angle % 360) + 360) % 360;
export const angleDifference = (actual: number, expected: number) =>
  normalize(actual - expected + 180) - 180;
const radians = Math.PI / 180;
export function bearing(a: Coord, b: Coord) {
  const lat1 = a[1] * radians,
    lat2 = b[1] * radians;
  const lon = (b[0] - a[0]) * radians;
  return normalize(
    Math.atan2(
      Math.sin(lon) * Math.cos(lat2),
      Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon),
    ) / radians,
  );
}
function xy(a: Coord, origin: Coord): Coord {
  return [
    (a[0] - origin[0]) * 111320 * Math.cos(origin[1] * radians),
    (a[1] - origin[1]) * 111320,
  ];
}
export function distance(a: Coord, b: Coord) {
  return Math.hypot(...xy(a, b));
}
export type Fix = {
  coordinates: Coord;
  accuracy: number;
  time: number;
  heading: number | null;
  speed: number | null;
};
export const freshFix = (fix: Fix | null, now: number, limit = 15) =>
  !!fix &&
  fix.coordinates.every(Number.isFinite) &&
  Math.abs(fix.coordinates[0]) <= 180 &&
  Math.abs(fix.coordinates[1]) <= 90 &&
  Number.isFinite(fix.accuracy) &&
  fix.accuracy >= 0 &&
  fix.accuracy <= limit &&
  now - fix.time <= 7000 &&
  now >= fix.time - 1000;

// A phone heading is intentionally never used as a walking course.
export function movementCourse(previous: Fix | null, fix: Fix): number | null {
  if (
    !previous ||
    !freshFix(previous, previous.time, 12) ||
    !freshFix(fix, fix.time, 12)
  )
    return null;
  const seconds = (fix.time - previous.time) / 1000;
  const moved = distance(previous.coordinates, fix.coordinates);
  if (
    seconds < 1 ||
    seconds > 20 ||
    moved < Math.max(6, previous.accuracy + fix.accuracy)
  )
    return null;
  const speed = moved / seconds;
  if (
    speed < 0.65 ||
    speed > 3 ||
    (fix.speed !== null &&
      (!Number.isFinite(fix.speed) || fix.speed < 0.65 || fix.speed > 3))
  )
    return null;
  const derived = bearing(previous.coordinates, fix.coordinates);
  if (
    fix.heading !== null &&
    Number.isFinite(fix.heading) &&
    fix.heading >= 0 &&
    fix.heading < 360
  ) {
    if (Math.abs(angleDifference(fix.heading, derived)) > 25) return null;
    return fix.heading;
  }
  return derived;
}

export type Match = {
  bearing: number | null;
  token: string;
  reason: string;
  offRoute: boolean;
  distance: number;
};
export function matchRoute(route: Route, fix: Fix): Match {
  const edges: {
    bearing: number;
    distance: number;
    token: string;
    a: Coord;
    b: Coord;
    mode: string;
  }[] = [];
  route.segments.forEach((segment, i) =>
    segment.coordinates.slice(1).forEach((b, j) => {
      const a = segment.coordinates[j],
        av = xy(a, fix.coordinates),
        bv = xy(b, fix.coordinates);
      const dx = bv[0] - av[0],
        dy = bv[1] - av[1],
        length2 = dx * dx + dy * dy;
      if (length2 < 4) return;
      const t = Math.max(0, Math.min(1, -(av[0] * dx + av[1] * dy) / length2));
      const direction = bearing(a, b);
      edges.push({
        a,
        b,
        bearing: direction,
        distance: Math.hypot(av[0] + dx * t, av[1] + dy * t),
        token: `${i}:${Math.round(direction / 15) % 24}`,
        mode: segment.mode,
      });
    }),
  );
  edges.sort((a, b) => a.distance - b.distance);
  const edge = edges[0];
  const result = (reason: string, offRoute = false): Match => ({
    bearing: null,
    token: edge?.token || "none",
    reason,
    offRoute,
    distance: edge?.distance ?? Infinity,
  });
  if (!edge) return result("Walking route geometry is unavailable.");
  if (edge.distance > Math.max(30, fix.accuracy * 2))
    return result(
      "You appear away from the planned route. Stop somewhere safe and review your route.",
      true,
    );
  if (edge.mode !== "walk")
    return result(
      edge.mode === "bus"
        ? "Compass guidance is paused on the transit leg."
        : "This approach is not mapped precisely enough for compass guidance.",
    );
  if (
    route.steps.some(
      (s) =>
        s.crossing &&
        distance(s.coordinates, fix.coordinates) < 18 + fix.accuracy,
    )
  )
    return result(
      "Near a crossing. Compass corrections are paused. Use the crossing signal and your usual mobility aids.",
    );
  if (
    distance(fix.coordinates, route.coordinates[route.coordinates.length - 1]) <
    10 + fix.accuracy
  )
    return result(
      "Near the destination. Confirm the entrance using your usual mobility aids.",
    );
  if (
    edges.some(
      (other) =>
        other !== edge &&
        other.distance <= edge.distance + Math.max(5, fix.accuracy) &&
        Math.abs(angleDifference(other.bearing, edge.bearing)) > 30,
    )
  )
    return result(
      "Near a turn or overlapping route. Direction is uncertain; corrections are paused.",
    );
  return {
    bearing: edge.bearing,
    token: edge.token,
    reason: "",
    offRoute: false,
    distance: edge.distance,
  };
}

export type OrientationState =
  | "ALIGNED"
  | "POSSIBLE_DRIFT"
  | "DEVIATED"
  | "UNCERTAIN";
export type Feedback =
  | "drift"
  | "deviated"
  | "uncertain"
  | "realigned"
  | "aligned";
export type OrientationResult = {
  state: OrientationState;
  reason: string;
  difference: number | null;
  heading: number | null;
  feedback?: Feedback;
};
export type EngineConfig = {
  aligned: number;
  deviated: number;
  hysteresis: number;
  driftMs: number;
  deviationMs: number;
  alignmentMs: number;
  cooldownMs: number;
};
export const defaults: EngineConfig = {
  aligned: 15,
  deviated: 35,
  hysteresis: 5,
  driftMs: 4000,
  deviationMs: 3000,
  alignmentMs: 1500,
  cooldownMs: 12000,
};
export class OrientationEngine {
  private state: OrientationState = "UNCERTAIN";
  private candidate: OrientationState = "UNCERTAIN";
  private since = 0;
  private lastAlert = -Infinity;
  private lastConfirmation = -Infinity;
  private lastFeedback: Feedback | undefined;
  private token = "";
  private changedAt = -Infinity;
  private smoothed: number | null = null;
  private samples: number[] = [];
  private sampleTime = -1;
  private drifted = false;
  private initialConfirmation = false;
  private pending: Feedback | undefined;
  constructor(private config: EngineConfig = defaults) {}
  update(input: {
    now: number;
    expected: number | null;
    heading: number | null;
    sampleTime: number;
    token: string;
    reason?: string;
    pointing?: boolean;
  }): OrientationResult {
    const { now, expected, heading, pointing } = input;
    if (this.token !== input.token) {
      this.token = input.token;
      this.changedAt = now;
      this.smoothed = null;
      this.samples = [];
      this.sampleTime = -1;
      this.candidate = "UNCERTAIN";
      this.state = "UNCERTAIN";
      this.since = now;
      this.initialConfirmation = false;
      this.drifted = false;
      this.pending = undefined;
    }
    let reason = input.reason || "";
    if (
      !reason &&
      (!Number.isFinite(input.sampleTime) ||
        now - input.sampleTime > 7000 ||
        input.sampleTime > now + 1000)
    )
      reason = "Heading reading is old. Corrections are paused.";
    if (
      !reason &&
      (expected === null ||
        heading === null ||
        !Number.isFinite(expected) ||
        !Number.isFinite(heading) ||
        heading < 0 ||
        heading >= 360)
    )
      reason = "Waiting for reliable direction readings.";
    if (!reason && now - this.changedAt < 2500)
      reason =
        "Checking the route direction. Keep still while pointing, or continue using your usual mobility aids.";
    if (!reason && heading !== null && this.sampleTime !== input.sampleTime) {
      this.sampleTime = input.sampleTime;
      this.samples.push(heading);
      this.samples = this.samples.slice(-6);
      this.smoothed =
        this.smoothed === null
          ? heading
          : normalize(
              this.smoothed + angleDifference(heading, this.smoothed) * 0.4,
            );
    }
    if (
      !reason &&
      this.samples.length >= 3 &&
      this.samples.some(
        (a) => Math.abs(angleDifference(a, this.smoothed!)) > 28,
      )
    )
      reason = "Heading readings are fluctuating. Corrections are paused.";
    if (!reason && pointing && this.samples.length < 3)
      reason = "Heading readings are settling. Hold the phone steady.";
    const difference =
      !reason && this.smoothed !== null && expected !== null
        ? angleDifference(this.smoothed, expected)
        : null;
    if (reason) {
      this.smoothed = null;
      // Keep noisy samples briefly so fluctuations cannot confirm alignment.
      if (!reason.startsWith("Heading readings")) this.samples = [];
      this.candidate = "UNCERTAIN";
      const changed = this.state !== "UNCERTAIN";
      this.state = "UNCERTAIN";
      if (this.pending !== "uncertain") this.pending = undefined;
      const feedback =
        (changed || this.lastFeedback === undefined) &&
        now - this.changedAt >= 5000
          ? this.alert("uncertain", now)
          : undefined;
      return {
        state: this.state,
        reason,
        difference: null,
        heading: null,
        feedback: feedback || this.flush(now),
      };
    }
    const error = Math.abs(difference!);
    const alignedLimit =
      this.state === "ALIGNED"
        ? this.config.aligned + this.config.hysteresis
        : this.config.aligned;
    const deviationLimit =
      this.state === "DEVIATED"
        ? this.config.deviated - this.config.hysteresis
        : this.config.deviated;
    const next: OrientationState =
      error <= alignedLimit
        ? "ALIGNED"
        : error > deviationLimit
          ? "DEVIATED"
          : "POSSIBLE_DRIFT";
    if (next !== this.candidate) {
      this.candidate = next;
      this.since = now;
    }
    const delay =
      next === "ALIGNED"
        ? this.config.alignmentMs
        : next === "DEVIATED"
          ? this.config.deviationMs
          : this.config.driftMs;
    let feedback: Feedback | undefined;
    if (now - this.since >= delay) {
      if (next !== this.state) {
        this.state = next;
        if (next === "ALIGNED") {
          this.pending = undefined;
          if (this.drifted) feedback = this.alert("realigned", now);
          else if (pointing && !this.initialConfirmation)
            feedback = this.alert("aligned", now);
          this.initialConfirmation = true;
          this.drifted = false;
        } else {
          this.drifted = true;
          feedback = this.alert(
            next === "DEVIATED" ? "deviated" : "drift",
            now,
          );
        }
      }
    }
    return {
      state: this.state,
      reason:
        this.state === "UNCERTAIN"
          ? "Checking sustained heading. Corrections are paused."
          : "",
      difference,
      heading: this.smoothed,
      feedback: feedback || (next === this.state ? this.flush(now) : undefined),
    };
  }
  private alert(feedback: Feedback, now: number): Feedback | undefined {
    if (feedback === "aligned" || feedback === "realigned") {
      if (now - this.lastConfirmation < 4000) return;
      this.lastConfirmation = now;
      return feedback;
    }
    if (now - this.lastAlert < this.config.cooldownMs) {
      this.pending = feedback;
      return;
    }
    this.pending = undefined;
    this.lastAlert = now;
    this.lastFeedback = feedback;
    return feedback;
  }
  private flush(now: number): Feedback | undefined {
    if (!this.pending) return;
    const expected =
      this.state === "UNCERTAIN"
        ? "uncertain"
        : this.state === "DEVIATED"
          ? "deviated"
          : this.state === "POSSIBLE_DRIFT"
            ? "drift"
            : undefined;
    if (this.pending !== expected) {
      this.pending = undefined;
      return;
    }
    return this.alert(this.pending, now);
  }
}
