import { test, expect } from "@playwright/test";
import {
  angleDifference,
  bearing,
  freshFix,
  matchRoute,
  movementCourse,
  OrientationEngine,
  defaults,
} from "../src/compass/orientationEngine";
import type { Fix, OrientationResult } from "../src/compass/orientationEngine";
import { magneticToTrue, readCompass } from "../src/compass/sensors";
import { followHeading } from "../src/compass/useCompassDial";
import type { Route } from "../src/model";

const fix = (lon = -79.38, time = 10000, accuracy = 2): Fix => ({
  coordinates: [lon, 43.65],
  accuracy,
  time,
  heading: null,
  speed: 1.2,
});
function harness(config = defaults) {
  const engine = new OrientationEngine(config);
  let now = 0;
  const events: string[] = [];
  function run(
    heading: number | null,
    duration: number,
    options: Partial<Parameters<OrientationEngine["update"]>[0]> = {},
  ) {
    let result: OrientationResult;
    for (let i = 0; i <= duration; i += 500) {
      result = engine.update({
        now,
        expected: 0,
        heading,
        token: "straight",
        sampleTime: now,
        ...options,
      });
      if (result.feedback) events.push(result.feedback);
      now += 500;
    }
    return result!;
  }
  return { run, events };
}
test("signed angles wrap through north and validate freshness", () => {
  expect(angleDifference(359, 1)).toBe(-2);
  expect(angleDifference(1, 359)).toBe(2);
  expect(angleDifference(180, 0)).toBe(-180);
  expect(angleDifference(720, 0)).toBe(0);
  expect(bearing([0, 0], [1, 0])).toBeCloseTo(90);
  expect(freshFix(fix(), 10000)).toBe(true);
  expect(freshFix(fix(), 18000)).toBe(false);
  expect(freshFix(fix(-79.38, 10000, 40), 10000)).toBe(false);
  expect(freshFix({ ...fix(), accuracy: NaN }, 10000)).toBe(false);
});
test("GPS course rejects stationary users, drift, impossible speeds and conflicting headings", () => {
  const a = fix(-79.38, 10000);
  expect(movementCourse(a, fix(-79.38, 16000))).toBeNull();
  expect(
    movementCourse({ ...a, accuracy: 25 }, fix(-79.3799, 16000)),
  ).toBeNull();
  expect(movementCourse(a, fix(-79.37, 16000))).toBeNull();
  expect(
    movementCourse(a, { ...fix(-79.3799, 16000), heading: 270 }),
  ).toBeNull();
  expect(movementCourse(a, fix(-79.3799, 16000))).toBeCloseTo(90, 1);
  expect(movementCourse(a, { ...fix(-79.3799, 16000), speed: 0 })).toBeNull();
});
test("thresholds, hysteresis, sustained drift and confirmation are not per-reading alerts", () => {
  const h = harness();
  expect(h.run(15, 7000).state).toBe("ALIGNED");
  expect(h.run(19, 5000).state).toBe("ALIGNED");
  expect(h.run(30, 1500).state).toBe("ALIGNED");
  expect(h.run(30, 6000).state).toBe("POSSIBLE_DRIFT");
  expect(h.run(35, 5000).state).toBe("POSSIBLE_DRIFT");
  expect(h.run(70, 16000).state).toBe("DEVIATED");
  for (const heading of [65, 60, 55, 50, 45, 40, 35]) h.run(heading, 1000);
  expect(h.run(33, 5000).state).toBe("DEVIATED");
  expect(h.run(0, 10000).state).toBe("ALIGNED");
  expect(h.events.filter((e) => e === "drift")).toHaveLength(1);
  expect(h.events.filter((e) => e === "deviated")).toHaveLength(1);
  expect(h.events.filter((e) => e === "realigned")).toHaveLength(1);
});
test("rapid noisy headings never confirm alignment and recover when steady", () => {
  const h = harness();
  for (let i = 0; i < 30; i++) h.run(i % 2 ? 80 : 0, 0, { pointing: true });
  expect(h.events).not.toContain("aligned");
  expect(h.run(0, 10000, { pointing: true }).state).toBe("ALIGNED");
  expect(h.events.filter((e) => e === "aligned")).toHaveLength(1);
});
test("uncertain readings suspend corrections, stale headings and transitions settle before recovery", () => {
  const h = harness();
  h.run(0, 6000);
  expect(h.run(null, 1000).state).toBe("UNCERTAIN");
  expect(h.run(NaN, 1000).difference).toBeNull();
  expect(h.run(0, 6000).state).toBe("ALIGNED");
  expect(h.run(90, 0, { token: "turn", expected: 90 }).state).toBe("UNCERTAIN");
  expect(h.run(90, 6500, { token: "turn", expected: 90 }).state).toBe(
    "ALIGNED",
  );
});
test("alert cooldown prevents repeated warnings across fluctuations", () => {
  const h = harness({
    ...defaults,
    driftMs: 0,
    deviationMs: 0,
    alignmentMs: 0,
    cooldownMs: 60000,
  });
  h.run(80, 6000);
  h.run(25, 6000);
  h.run(90, 6000);
  expect(h.events.filter((e) => e === "drift" || e === "deviated").length).toBe(
    1,
  );
});

test("a queued escalation is delivered after cooldown and north wraparound stays aligned", () => {
  const h = harness();
  h.run(0, 6500);
  h.run(28, 9000);
  expect(h.events).toContain("drift");
  for (const heading of [35, 45, 55, 65]) h.run(heading, 1000);
  h.run(70, 18000);
  expect(h.events.filter((e) => e === "deviated")).toHaveLength(1);
  const north = harness();
  expect(north.run(359, 6500).state).toBe("ALIGNED");
  expect(north.run(1, 6500).state).toBe("ALIGNED");
});

test("phone alignment needs independent samples and stale samples suspend it", () => {
  const h = harness();
  expect(h.run(0, 6000, { pointing: true, sampleTime: 3000 }).state).toBe(
    "UNCERTAIN",
  );
  expect(h.events).not.toContain("aligned");
  expect(h.run(0, 6500, { pointing: true }).state).toBe("ALIGNED");
  expect(h.run(0, 0, { pointing: true, sampleTime: 0 }).state).toBe(
    "UNCERTAIN",
  );
});
const route = {
  coordinates: [
    [-79.382, 43.65],
    [-79.378, 43.65],
  ],
  steps: [],
  segments: [
    {
      mode: "walk",
      coordinates: [
        [-79.382, 43.65],
        [-79.38, 43.65],
        [-79.378, 43.65],
      ],
    },
  ],
} as unknown as Route;
test("route matching uses local walking segments and suppresses crossing, turn, transit and off-route corrections", () => {
  expect(matchRoute(route, fix()).bearing).toBeCloseTo(90, 1);
  const crossing = {
    ...route,
    steps: [{ crossing: true, coordinates: fix().coordinates }],
  } as Route;
  expect(matchRoute(crossing, fix()).reason).toContain("crossing");
  const turn = {
    ...route,
    segments: [
      {
        mode: "walk",
        coordinates: [
          [-79.382, 43.65],
          [-79.38, 43.65],
          [-79.38, 43.652],
        ],
      },
    ],
  } as Route;
  expect(matchRoute(turn, fix()).bearing).toBeNull();
  const bus = {
    ...route,
    segments: [{ ...route.segments[0], mode: "bus" }],
  } as Route;
  expect(matchRoute(bus, fix()).reason).toContain("transit");
  expect(matchRoute(route, fix(-79.39)).offRoute).toBe(true);
  const farDestination = {
    ...route,
    coordinates: [...route.coordinates.slice(0, 1), [-79.378, 43.67]],
  } as Route;
  expect(matchRoute(farDestination, fix()).bearing).toBeCloseTo(90, 1);
});
test("compass rejects relative, uncalibrated and tilted data and corrects magnetic north", () => {
  const reading = {
    alpha: 270,
    beta: 0,
    gamma: 0,
    absolute: true,
  } as DeviceOrientationEvent;
  expect(readCompass(reading, 0, 0).magnetic).toBe(90);
  expect(
    readCompass({ ...reading, absolute: false } as DeviceOrientationEvent, 0, 0)
      .magnetic,
  ).toBeNull();
  expect(
    readCompass({ ...reading, beta: 70 } as DeviceOrientationEvent, 0, 0)
      .magnetic,
  ).toBeNull();
  expect(readCompass(reading, 0, 90).magnetic).toBeNull();
  expect(
    readCompass(
      {
        ...reading,
        webkitCompassHeading: 90,
        webkitCompassAccuracy: -1,
      } as DeviceOrientationEvent,
      0,
      0,
    ).magnetic,
  ).toBeNull();
  const trueHeading = magneticToTrue(90, fix(), new Date("2026-11-07"));
  expect(trueHeading).toBeGreaterThan(78);
  expect(trueHeading).toBeLessThan(82);
  expect(magneticToTrue(90, fix(), new Date("2031-01-01"))).toBeNull();
});

test("Safari native headings can display while tilt or uncertain accuracy pauses alignment", () => {
  const native = {
    absolute: false,
    alpha: null,
    beta: 80,
    gamma: 2,
    webkitCompassHeading: 90,
    webkitCompassAccuracy: 10,
  } as unknown as DeviceOrientationEvent;
  const tilted = readCompass(native, 1000, 0);
  expect(tilted.magnetic).toBe(90);
  expect(tilted.reason).toBe("");
  expect(tilted.guidanceReason).toContain("flatter");
  const flat = { ...native, beta: 0 };
  expect(
    readCompass(flat as DeviceOrientationEvent, 1000, 0).guidanceReason,
  ).toBeUndefined();
  const uncertain = readCompass(
    { ...flat, webkitCompassAccuracy: 45 } as DeviceOrientationEvent,
    1000,
    0,
  );
  expect(uncertain.magnetic).toBe(90);
  expect(uncertain.guidanceReason).toContain("accuracy is low");
  const noAccuracy = readCompass(
    { ...flat, webkitCompassAccuracy: undefined } as DeviceOrientationEvent,
    1000,
    0,
  );
  expect(noAccuracy.magnetic).toBe(90);
  expect(noAccuracy.guidanceReason).toContain("accuracy is unavailable");
  expect(
    readCompass(
      { ...flat, webkitCompassAccuracy: -1 } as DeviceOrientationEvent,
      1000,
      0,
    ).magnetic,
  ).toBeNull();
  expect(readCompass(native, 1000, 90).reason).toContain("Rotate");
});

test("dial smoothing follows the short path through north and responds consistently at different frame rates", () => {
  const wrapped = followHeading(359, 1, 16);
  expect(Math.abs(angleDifference(wrapped, 359))).toBeLessThan(2);
  expect(Math.abs(angleDifference(wrapped, 1))).toBeLessThan(2);
  expect(followHeading(0, 90, 200)).toBeGreaterThan(85);
  const result = (frames: number) => {
    let value = 0;
    for (let i = 0; i < frames; i++)
      value = followHeading(value, 90, 1000 / frames);
    return value;
  };
  expect(result(60)).toBeCloseTo(result(120), 8);
});
