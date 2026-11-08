import { test, expect } from "@playwright/test";
import { isDesktopDevice } from "../src/compass/device";

test("desktop detection keeps phones and iPadOS available", () => {
  expect(isDesktopDevice("Windows NT 10.0", 10)).toBe(true);
  expect(isDesktopDevice("Macintosh; Intel Mac OS X", 0)).toBe(true);
  expect(isDesktopDevice("X11; Linux x86_64", 0)).toBe(true);
  expect(isDesktopDevice("iPhone; CPU iPhone OS 26_5", 5)).toBe(false);
  expect(isDesktopDevice("Linux; Android 16", 5)).toBe(false);
  expect(isDesktopDevice("Macintosh; Intel Mac OS X", 5)).toBe(false);
});

for (const width of [390, 1440]) {
  test(`desktop compass entry points notify without requesting sensors at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem("luma-screenReader", "true");
      (window as any).sensorCalls = 0;
      Object.defineProperty(DeviceOrientationEvent, "requestPermission", { configurable: true, value: () => { (window as any).sensorCalls++; return Promise.resolve("granted"); } });
      Object.defineProperty(navigator, "geolocation", { configurable: true, value: { watchPosition: () => { (window as any).sensorCalls++; return 1; }, clearWatch: () => {} } });
    });
    await page.route("**/api/locations", r => r.fulfill({ json: { features: [] } }));
    const coordinates = [[-79.383, 43.652], [-79.382, 43.652]];
    await page.route("**/api/routes", r => r.fulfill({ json: { routes: [{
      id: "demo", name: "Fastest walk", mode: "walk", minutes: 2, distance: 100,
      crossings: 0, audible: 0, tactile: 0, coordinates, snap_distances: [0, 0],
      timing: "estimated", departure_time: "2026-11-07T12:00:00-05:00", arrival_time: "2026-11-07T12:02:00-05:00",
      duration_seconds: 120, explanation: "", segments: [{ mode: "walk", coordinates }],
      steps: [{ kind: "walk", title: "Head east", text: "Head east for 100 metres.", distance: 100, crossing: false, bearing: 90, coordinates: coordinates[0] }],
    }] } }));
    await page.goto("/");
    await page.getByRole("button", { name: "Try Luma", exact: true }).click();
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Use Luma", exact: true }).click();
    await page.getByRole("button", { name: "Compass", exact: true }).click();
    await expect(page.getByText("Compass is not available on desktop.", { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Compass mode" })).toHaveCount(0);
    await page.getByRole("button", { name: "Dismiss notification", exact: true }).click();
    await page.getByRole("button", { name: "Example journey Try a walk", exact: true }).click();
    await page.getByRole("button", { name: "Preview route 1", exact: true }).click();
    await page.getByRole("button", { name: "Compass", exact: true }).click();
    await expect(page.getByText("Compass is not available on desktop.", { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Compass mode" })).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).sensorCalls)).toBe(0);
  });
}
