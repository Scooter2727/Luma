import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
const route = {
  id: "compass-test",
  name: "Fastest",
  coordinates: [
    [-79.382, 43.65],
    [-79.378, 43.65],
  ],
  distance: 320,
  minutes: 5,
  crossings: 0,
  audible: 0,
  tactile: 0,
  snap_distances: [0, 0],
  mode: "walk",
  timing: "estimated",
  departure_time: "2026-11-07T12:00:00-05:00",
  arrival_time: "2026-11-07T12:05:00-05:00",
  duration_seconds: 300,
  explanation: "Shortest walking journey.",
  segments: [
    {
      mode: "walk",
      coordinates: [
        [-79.382, 43.65],
        [-79.378, 43.65],
      ],
    },
  ],
  steps: [
    {
      coordinates: [-79.382, 43.65],
      text: "Continue along Front Street for 320 metres.",
      title: "Continue along Front Street",
      kind: "walk",
      crossing: false,
      distance: 320,
      bearing: 90,
    },
    {
      coordinates: [-79.378, 43.65],
      text: "Arrive at the destination.",
      title: "Arrive",
      kind: "arrive",
      crossing: false,
      distance: 0,
    },
  ],
};
async function boot(page: Page, width = 390) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("luma-onboarding-complete", "true");
    localStorage.setItem("luma-screenReader", "true");
    const state = {
      watches: 0,
      clears: 0,
      vibrates: [] as number[][],
      callback: null as PositionCallback | null,
    };
    (window as any).compassTest = state;
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition: (callback: PositionCallback) => {
          state.watches++;
          state.callback = callback;
          return 42;
        },
        clearWatch: () => {
          state.clears++;
          state.callback = null;
        },
      },
    });
    Object.defineProperty(navigator, "vibrate", {
      value: (pattern: number[] | number) => {
        state.vibrates.push(Array.isArray(pattern) ? pattern : [pattern]);
        return true;
      },
    });
  });
  await page.route("**/api/locations", (r) =>
    r.fulfill({ json: { features: [] } }),
  );
  await page.route("**/api/transit/meta", (r) =>
    r.fulfill({
      json: { service_start: "2026-11-01", service_end: "2026-12-21" },
    }),
  );
  await page.route("**/api/routes", (r) =>
    r.fulfill({ json: { routes: [route] } }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Example journey Try a walk" })
    .click();
  await page
    .getByRole("button", { name: "Preview route 1", exact: true })
    .click();
}
async function audit(page: Page) {
  const result = await new AxeBuilder({ page }).exclude(".map").analyze();
  expect(
    result.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact || ""),
    ),
  ).toEqual([]);
}
for (const width of [390, 1440])
  test(`compass demo is accessible and independent of GPS at ${width}px`, async ({
    page,
  }) => {
    await boot(page, width);
    await page
      .getByRole("button", { name: "Try compass demo", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Play preview", exact: true }),
    ).toBeDisabled();
    await expect(page.locator(".compass-mode")).toContainText("DEMO");
    await expect
      .poll(() => page.evaluate(() => (window as any).compassTest.watches))
      .toBe(0);
    await expect(page.locator(".compass-status strong")).toHaveText(
      "Direction aligned",
      { timeout: 12000 },
    );
    await page.getByText("Developer demo", { exact: true }).click();
    await page
      .getByRole("slider", { name: "Movement heading", exact: true })
      .fill("160");
    await expect(page.locator(".compass-status strong")).toHaveText(
      "Direction differs from route",
      { timeout: 15000 },
    );
    await page
      .getByRole("slider", { name: "GPS accuracy (metres)", exact: true })
      .fill("60");
    await expect(page.locator(".compass-status strong")).toHaveText(
      "Direction uncertain",
    );
    await page
      .getByRole("slider", { name: "GPS accuracy (metres)", exact: true })
      .fill("5");
    await page
      .getByRole("button", { name: "Find my direction", exact: true })
      .click();
    await expect(page.locator(".compass-status strong")).toHaveText(
      "Direction aligned",
      { timeout: 12000 },
    );
    await expect(page.locator(".compass-dial")).toContainText("Phone aligned");
    await expect(page.locator(".compass-status")).toContainText(
      "Approximate phone alignment only",
    );
    await page.getByText("Compass options", { exact: true }).click();
    await page.getByLabel("Spoken compass feedback", { exact: true }).uncheck();
    await page.getByLabel("Vibration feedback", { exact: true }).uncheck();
    await audit(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByText("Compass options", { exact: true }).click();
    await page.getByText("Developer demo", { exact: true }).click();
    await page
      .locator(".compass-panel")
      .evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `artifacts/luma-compass-${width}.png` });
    await page.getByText("Developer demo", { exact: true }).click();
    await page.getByRole("button", { name: "Exit demo", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Luma Compass Off", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
  });
test("live location failures suspend corrections and leaving navigation clears the watch", async ({
  page,
}) => {
  await boot(page);
  await page
    .getByRole("button", { name: "Luma Compass Off", exact: true })
    .click();
  expect(await page.evaluate(() => (window as any).compassTest.watches)).toBe(
    1,
  );
  await page.evaluate(() =>
    (window as any).compassTest.callback({
      timestamp: Date.now(),
      coords: {
        longitude: -79.38,
        latitude: 43.65,
        accuracy: 80,
        heading: 90,
        speed: 1.2,
      },
    }),
  );
  await expect(page.locator(".compass-status")).toContainText(
    "GPS accuracy is too low",
  );
  await page.getByRole("button", { name: "End route", exact: true }).click();
  expect(await page.evaluate(() => (window as any).compassTest.clears)).toBe(1);
});
test("high contrast compass retains labels and large text", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("luma-theme", "contrast");
    localStorage.setItem("luma-large", "true");
  });
  await boot(page, 320);
  await page
    .getByRole("button", { name: "Try compass demo", exact: true })
    .click();
  await expect(page.locator(".compass-status strong")).toHaveText(
    "Direction aligned",
    { timeout: 12000 },
  );
  await audit(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .locator(".compass-panel")
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: "artifacts/luma-compass-contrast.png" });
});

test("denied compass permission stays uncertain and can be retried", async ({
  page,
}) => {
  await boot(page);
  await page
    .getByRole("button", { name: "Luma Compass Off", exact: true })
    .click();
  await page.evaluate(() => {
    const refresh = () =>
      (window as any).compassTest.callback?.({
        timestamp: Date.now(),
        coords: {
          longitude: -79.38,
          latitude: 43.65,
          accuracy: 3,
          heading: null,
          speed: 0,
        },
      });
    refresh();
    (window as any).gpsTimer = setInterval(refresh, 1000);
    Object.defineProperty(DeviceOrientationEvent, "requestPermission", {
      configurable: true,
      value: () => Promise.resolve("denied"),
    });
  });
  await page
    .getByRole("button", { name: "Find my direction", exact: true })
    .click();
  await expect(page.locator(".compass-status")).toContainText(
    "Compass permission was denied",
  );
  await expect(page.locator(".compass-dial")).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(DeviceOrientationEvent, "requestPermission", {
      configurable: true,
      value: () => Promise.resolve("granted"),
    });
  });
  await page
    .getByRole("button", { name: "Restart direction check", exact: true })
    .click();
  await page.evaluate(() => {
    (window as any).headingTimer = setInterval(
      () =>
        window.dispatchEvent(
          new DeviceOrientationEvent("deviceorientationabsolute", {
            absolute: true,
            alpha: 260,
            beta: 0,
            gamma: 0,
          }),
        ),
      100,
    );
  });
  await expect(page.locator(".compass-status strong")).toHaveText(
    "Direction aligned",
    { timeout: 12000 },
  );
  await page.evaluate(() => {
    clearInterval((window as any).headingTimer);
    clearInterval((window as any).gpsTimer);
  });
  await expect(page.locator(".compass-status")).toContainText(
    "Waiting for compass readings",
    { timeout: 7000 },
  );
  await page
    .getByRole("button", { name: "Luma Compass On", exact: true })
    .click();
  expect(await page.evaluate(() => (window as any).compassTest.clears)).toBe(1);
});

test("sustained off-route locations can recalculate using the existing planner", async ({
  page,
}) => {
  await boot(page);
  await page
    .getByRole("button", { name: "Luma Compass Off", exact: true })
    .click();
  await page.evaluate(() => {
    const refresh = () =>
      (window as any).compassTest.callback?.({
        timestamp: Date.now(),
        coords: {
          longitude: -79.39,
          latitude: 43.65,
          accuracy: 3,
          heading: 90,
          speed: 1.2,
        },
      });
    refresh();
    (window as any).gpsTimer = setInterval(refresh, 1000);
  });
  const recalculate = page.getByRole("button", {
    name: "Recalculate from my location",
    exact: true,
  });
  await expect(recalculate).toBeVisible({ timeout: 15000 });
  const request = page.waitForRequest(
    (r) => r.url().endsWith("/api/routes") && r.method() === "POST",
  );
  await recalculate.click();
  expect((await request).postDataJSON().start).toEqual([-79.39, 43.65]);
  await expect(
    page.getByRole("button", { name: "Preview route 1", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).compassTest.clears)).toBe(1);
});
