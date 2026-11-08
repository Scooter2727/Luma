import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function demo(page: Page, width = 390, height = 844) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" });
    const w = window as any;
    localStorage.setItem("luma-screenReader", "true");
    Object.defineProperty(DeviceOrientationEvent, "requestPermission", { value: () => Promise.resolve("granted"), configurable: true });
    Object.defineProperty(navigator, "audioSession", { value: { type: "auto" }, configurable: true });
    Object.defineProperty(navigator, "geolocation", { value: { watchPosition: () => 1, clearWatch: () => {} }, configurable: true });
    w.notes = [];
    w.contexts = [];
    const NativeContext = AudioContext;
    w.AudioContext = class extends NativeContext {
      constructor() { super(); w.contexts.push(this); }
      createOscillator() {
        const node = super.createOscillator(), start = node.start.bind(node);
        node.start = (...args: Parameters<OscillatorNode["start"]>) => {
          w.notes.push(node.frequency.value);
          return start(...args);
        };
        return node;
      }
    };
  });
  await page.route("**/api/locations", r => r.fulfill({ json: { features: [] } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Try Luma", exact: true }).click();
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Use Luma", exact: true }).click();
  await page.getByRole("button", { name: "Compass", exact: true }).click();
  await page.evaluate(() => {
    const w = window as any;
    w.testHeading = 0;
    w.testAccuracy = 10;
    w.testTilt = 0;
    w.publish = () => {
      const event = new Event("deviceorientation");
      Object.assign(event, { absolute: false, beta: w.testTilt, gamma: 0, webkitCompassHeading: w.testHeading, webkitCompassAccuracy: w.testAccuracy });
      dispatchEvent(event);
    };
    w.publish();
    w.sensor = setInterval(w.publish, 100);
    Math.random = () => 0.5;
  });
  await expect(page.locator(".compass-reading strong")).toHaveText("0°");
  await page.locator(".compass-face").evaluate(el => {
    const rect = el.getBoundingClientRect();
    (window as any).beforeDemoBounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sound on. Mute beeps", exact: true })).toBeVisible();
}

test("demo beeps, survives approximate Safari samples, advances, and has rounded screen corners", async ({ page }) => {
  await demo(page);
  await expect.poll(() => page.evaluate(() => (window as any).notes.filter((f: number) => f === 740).length)).toBeGreaterThanOrEqual(3);
  expect(await page.evaluate(() => (navigator as any).audioSession.type)).toBe("playback");
  expect(await page.locator(".compass-fullscreen").evaluate(el => parseFloat(getComputedStyle(el, "::after").borderTopLeftRadius))).toBeGreaterThan(30);
  await page.evaluate(() => {
    const w = window as any;
    w.testHeading = 150; w.testAccuracy = undefined; w.testTilt = 60; w.notes = [];
  });
  await expect(page.locator(".compass-face")).toHaveAttribute("data-demo-state", "adjust");
  await expect.poll(() => page.evaluate(() => (window as any).notes.filter((f: number) => f === 520).length)).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => { const w = window as any; w.testHeading = 180; w.testAccuracy = 35; });
  await expect(page.locator(".compass-face")).toHaveAttribute("data-demo-state", "on");
  await expect(page.locator(".compass-face")).toHaveAttribute("data-round", "2", { timeout: 5000 });
  await page.getByRole("button", { name: "Stop demo", exact: true }).click();
  expect(await page.evaluate(() => (navigator as any).audioSession.type)).toBe("auto");
  const count = await page.evaluate(() => (window as any).notes.length);
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => (window as any).notes.length)).toBe(count);
});

test("interrupted Safari audio exposes retry and replaces the interrupted context", async ({ page }) => {
  await demo(page);
  await page.evaluate(() => {
    Object.defineProperty((window as any).contexts[0], "state", { configurable: true, get: () => "interrupted" });
  });
  const retry = page.getByRole("button", { name: "Sound off. Enable beeps", exact: true });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(page.getByRole("button", { name: "Sound on. Mute beeps", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).contexts.length)).toBe(2);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  expect(await page.evaluate(() => (navigator as any).audioSession.type)).toBe("auto");
});

test("cardinal letters stay within the dial through a full rotation", async ({ page }) => {
  await demo(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const heading of [0, 45, 90, 135, 180, 225, 270, 315, 359, 0]) {
    await page.evaluate(value => { (window as any).testHeading = value; (window as any).publish(); }, heading);
    await expect(page.locator(".compass-reading strong")).toHaveText(`${heading}°`);
    const bounds = await page.locator(".compass-face svg").boundingBox();
    for (const letter of await page.locator(".compass-cardinal").all()) {
      const box = (await letter.boundingBox())!;
      expect(box.x).toBeGreaterThan(bounds!.x);
      expect(box.y).toBeGreaterThan(bounds!.y);
      expect(box.x + box.width).toBeLessThan(bounds!.x + bounds!.width);
      expect(box.y + box.height).toBeLessThan(bounds!.y + bounds!.height);
    }
  }
});

for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1440, 1000]]) {
  test(`demo preserves compass size and position at ${width}x${height}`, async ({ page }) => {
    await demo(page, width, height);
    const before = await page.evaluate(() => (window as any).beforeDemoBounds);
    const during = (await page.locator(".compass-face").boundingBox())!;
    for (const key of ["x", "y", "width", "height"] as const) expect(during[key]).toBeCloseTo(before[key], 1);
    await page.getByRole("button", { name: "Stop demo", exact: true }).click();
    const after = (await page.locator(".compass-face").boundingBox())!;
    for (const key of ["x", "y", "width", "height"] as const) expect(after[key]).toBeCloseTo(before[key], 1);
  });
}
