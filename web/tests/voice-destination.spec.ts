import { test, expect, type Page } from "@playwright/test";

const first = { id: "rom", name: "Royal Ontario Museum", subtitle: "100 Queens Park", coordinates: [-79.3948, 43.6677] };
const second = { id: "ago", name: "Art Gallery of Ontario", subtitle: "317 Dundas Street West", coordinates: [-79.3925, 43.6536] };

async function boot(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("luma-screenReader", "true");
    localStorage.setItem("luma-sounds", "false");
    class Recognition {
      lang = "";
      interimResults = false;
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() { (window as any).recognizer = this; }
      stop() { this.onend?.(); }
    }
    (window as any).SpeechRecognition = Recognition;
  });
  await page.route("**/maps/simple.json", r => r.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.route("**/api/locations", r => r.fulfill({ json: { features: [] } }));
  await page.route("**/api/conditions**", r => r.fulfill({ json: { type: "FeatureCollection", features: [], available: true, revision: "test" } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Try Luma", exact: true }).click();
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Use Luma", exact: true }).click();
}

async function sayDestination(page: Page) {
  await page.getByRole("button", { name: "Say where to go", exact: true }).click();
  await page.evaluate(() => {
    (window as any).recognizer.onresult({ results: [[{ transcript: "museum" }]] });
    (window as any).recognizer.onend?.();
  });
}

test("spoken destinations plan to the first match without opening typing", async ({ page }) => {
  await page.route("**/api/search?*", r => r.fulfill({ json: [first, second] }));
  await page.route("**/api/routes", r => {
    const coordinates = [[-79.3806, 43.6453], first.coordinates];
    return r.fulfill({ json: { routes: [{
      id: "0", name: "Fastest walk", mode: "walk", minutes: 30, distance: 2000,
      crossings: 1, audible: 1, tactile: 0, coordinates, snap_distances: [0, 0],
      timing: "estimated", departure_time: "2026-11-08T12:00:00-05:00", arrival_time: "2026-11-08T12:30:00-05:00",
      duration_seconds: 1800, explanation: "", segments: [{ mode: "walk", coordinates }],
      steps: [{ kind: "walk", title: "Head north", text: "Head north.", distance: 2000, crossing: false, coordinates: coordinates[0] }],
    }] } });
  });
  await boot(page);
  const planned = page.waitForRequest(r => r.url().endsWith("/api/routes") && r.method() === "POST");
  await sayDestination(page);
  expect((await planned).postDataJSON()).toMatchObject({ end: first.coordinates, end_name: first.name });
  await expect(page.getByRole("heading", { name: "Route 1 of 1", exact: true })).toBeVisible();
  await expect(page.locator(".home-search")).toHaveCount(0);
});

for (const unavailable of [false, true]) {
  test(`voice search ${unavailable ? "failure" : "without matches"} stays on home and allows another attempt`, async ({ page }) => {
    let plans = 0;
    await page.route("**/api/routes", r => { plans++; return r.fulfill({ json: { routes: [] } }); });
    await page.route("**/api/search?*", r => r.fulfill(unavailable ? { status: 503, json: {} } : { json: [] }));
    await boot(page);
    await sayDestination(page);
    await expect(page.locator('.sr-only[role="status"]')).toContainText(unavailable ? "search is unavailable" : "No matching destination");
    await expect(page.getByRole("button", { name: "Say where to go", exact: true })).toBeEnabled();
    await expect(page.locator(".home-search")).toHaveCount(0);
    expect(plans).toBe(0);
  });
}
