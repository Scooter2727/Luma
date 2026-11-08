import { test, expect } from "@playwright/test";
import { TargetDemo, randomTarget } from "../src/compass/targetDemo";
import { angleDifference } from "../src/compass/orientationEngine";
import { pulseIntervals } from "../src/compass/demoFeedback";

test("random targets stay away from the current heading including north wraparound", () => {
  for (const heading of [0, 90, 180, 359])
    for (const random of [0, 0.25, 0.5, 0.999]) {
      const target = randomTarget(heading, () => random);
      expect(target).toBeGreaterThanOrEqual(0);
      expect(target).toBeLessThan(360);
      expect(Math.abs(angleDifference(heading, target))).toBeGreaterThanOrEqual(
        60,
      );
    }
});
test("alignment thresholds and beep cadence distinguish off target, adjustment and on track", () => {
  const game = new TargetDemo(0, () => 0.5); // 180° target
  expect(game.update(144, 0).state).toBe("off");
  expect(game.update(145, 100).state).toBe("adjust");
  expect(game.update(164.9, 200).state).toBe("adjust");
  expect(game.update(165, 300).state).toBe("on");
  expect(pulseIntervals.off).toBeLessThan(pulseIntervals.adjust);
});
test("three continuous aligned seconds advance the target exactly once", () => {
  const game = new TargetDemo(0, () => 0.5);
  for (let now = 0; now < 3000; now += 100) {
    const result = game.update(180, now);
    expect(result.round).toBe(1);
    expect(result.advanced).toBe(false);
  }
  const next = game.update(180, 3000);
  expect(next.advanced).toBe(true);
  expect(next.target).toBe(0);
  expect(next.round).toBe(2);
  expect(next.state).toBe("off");
  expect(game.update(180, 3100).round).toBe(2);
});
test("leaving alignment, losing a sensor reading, pauses and long timer gaps reset the hold", () => {
  const game = new TargetDemo(0, () => 0.5);
  for (let now = 0; now < 2000; now += 100) game.update(180, now);
  expect(game.update(150, 2000).heldMs).toBe(0);
  expect(game.update(180, 2100).heldMs).toBe(0);
  expect(game.update(null, 2200).state).toBe("waiting");
  expect(game.update(180, 2300).heldMs).toBe(0);
  expect(game.update(180, 2400, true).heldMs).toBe(0);
  expect(game.update(180, 2500).heldMs).toBe(0);
  expect(game.update(180, 9000).round).toBe(1);
  expect(game.update(180, 9000).heldMs).toBe(0);
});
