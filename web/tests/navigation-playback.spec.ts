import { test, expect } from "@playwright/test";

test("one playback button pauses, resumes, finishes and replays directions", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("luma-screenReader", "false");
    const w = window as any;
    w.spoken = []; w.pauses = 0; w.resumes = 0;
    Object.defineProperty(window, "speechSynthesis", { value: {
      cancel: () => {},
      speak: (utterance: SpeechSynthesisUtterance) => { w.currentSpeech = utterance; w.spoken.push(utterance.text); },
      pause: () => w.pauses++, resume: () => w.resumes++,
    }, configurable: true });
  });
  const coordinates = [[-79.383, 43.652], [-79.382, 43.652]];
  await page.route("**/api/speech/status", r => r.fulfill({ json: { available: false } }));
  await page.route("**/api/locations", r => r.fulfill({ json: { features: [] } }));
  await page.route("**/api/routes", r => r.fulfill({ json: { routes: [{
    id: "voice", name: "Fastest walk", mode: "walk", minutes: 2, distance: 100,
    crossings: 0, audible: 0, tactile: 0, coordinates, snap_distances: [0, 0],
    timing: "estimated", departure_time: "2026-11-07T12:00:00-05:00", arrival_time: "2026-11-07T12:02:00-05:00",
    duration_seconds: 120, explanation: "", segments: [{ mode: "walk", coordinates }],
    steps: [
      { kind: "walk", title: "Head east", text: "Head east for 100 metres.", distance: 100, crossing: false, bearing: 90, coordinates: coordinates[0] },
      { kind: "arrive", title: "Arrive", text: "Confirm the entrance.", distance: 0, crossing: false, coordinates: coordinates[1] },
    ],
  }] } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Try Luma", exact: true }).click();
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Use Luma", exact: true }).click();
  await page.getByRole("button", { name: "Example journey Try a walk", exact: true }).click();
  await page.getByRole("button", { name: "Preview route 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause directions", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).spoken.length)).toBe(1);
  await expect(page.getByRole("button", { name: "Repeat", exact: true })).toHaveCount(0);
  expect(await page.getByRole("button", { name: "Compass", exact: true }).evaluate(el => getComputedStyle(el).borderColor)).toBe("rgb(0, 0, 0)");
  await page.getByRole("button", { name: "Pause directions", exact: true }).click();
  expect(await page.evaluate(() => (window as any).pauses)).toBe(1);
  await page.getByRole("button", { name: "Play directions", exact: true }).click();
  expect(await page.evaluate(() => (window as any).resumes)).toBe(1);
  expect(await page.evaluate(() => (window as any).spoken.length)).toBe(1);
  await page.evaluate(() => (window as any).currentSpeech.onend(new Event("end")));
  await expect.poll(() => page.evaluate(() => (window as any).spoken.length)).toBe(2);
  await page.evaluate(() => (window as any).currentSpeech.onend(new Event("end")));
  await expect(page.getByRole("button", { name: "Play directions", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Play directions", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).spoken.length)).toBe(3);
  await expect(page.locator(".instruction-summary")).toHaveText("Head east");
});
