import { test, expect } from "@playwright/test";

test("button sounds work with keyboard and selections, can be muted, and persist", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("luma-screenReader", "true");
    const w = window as any, NativeContext = AudioContext;
    w.notes = 0; w.gestures = [];
    Object.defineProperty(navigator, "audioSession", { configurable: true, value: { type: "auto" } });
    w.AudioContext = class extends NativeContext {
      constructor() { super(); w.gestures.push(navigator.userActivation.isActive); }
      createOscillator() {
        const oscillator = super.createOscillator(), start = oscillator.start.bind(oscillator);
        oscillator.start = (...args: Parameters<OscillatorNode["start"]>) => { w.notes++; start(...args); };
        return oscillator;
      }
    };
  });
  await page.route("**/api/locations", r => r.fulfill({ json: { features: [] } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Try Luma", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).notes)).toBeGreaterThan(0);
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Use Luma", exact: true }).click();
  const before = await page.evaluate(() => (window as any).notes);
  await page.getByRole("button", { name: "Settings", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as any).notes)).toBeGreaterThan(before);
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await page.getByLabel("Button sounds", { exact: true }).uncheck();
  const muted = await page.evaluate(() => (window as any).notes);
  await page.getByRole("button", { name: "Faster", exact: true }).click();
  await page.getByRole("button", { name: "Slower", exact: true }).click();
  expect(await page.evaluate(() => (window as any).notes)).toBe(muted);
  expect(await page.evaluate(() => localStorage.getItem("luma-sounds"))).toBe("false");
  await page.getByLabel("Button sounds", { exact: true }).check();
  await expect.poll(() => page.evaluate(() => (window as any).notes)).toBeGreaterThan(muted);
  await expect.poll(() => page.evaluate(() => (navigator as any).audioSession.type)).toBe("auto");
  expect(await page.evaluate(() => (window as any).gestures.every(Boolean))).toBe(true);
  await page.getByLabel("Button sounds", { exact: true }).uncheck();
  await page.reload();
  await page.getByRole("button", { name: "Try Luma", exact: true }).click();
  expect(await page.evaluate(() => (window as any).notes)).toBe(0);
});

test("overlapping button and compass sounds keep playback until both release it", async ({ page }) => {
  await page.goto("/");
  const states = await page.evaluate(async () => {
    Object.defineProperty(navigator, "audioSession", { configurable: true, value: { type: "auto" } });
    const { acquirePlaybackSession } = await import("/web/src/compass/audioSession.ts" as string);
    const button = acquirePlaybackSession(), compass = acquirePlaybackSession();
    button(); button();
    const shared = (navigator as any).audioSession.type;
    compass();
    return [shared, (navigator as any).audioSession.type];
  });
  expect(states).toEqual(["playback", "auto"]);
});
