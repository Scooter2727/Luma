import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
async function boot(page: Page, width = 390, height = 844) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() =>
    localStorage.setItem("luma-onboarding-complete", "true"),
  );
  await page.goto("/");
}
async function audit(page: Page) {
  const result = await new AxeBuilder({ page }).exclude(".map").analyze();
  expect(
    result.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact || ""),
    ),
  ).toEqual([]);
}
async function tryWalk(page: Page) {
  await page
    .getByRole("button", { name: "Example journey Try a walk" })
    .click();
  await expect(
    page.getByRole("button", { name: "Preview route 1", exact: true }),
  ).toBeVisible({ timeout: 65000 });
}

test("five-step onboarding saves direction, crossing and display choices", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Voice guidance", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByRole("radio", { name: "Clock “Toward 2 o’clock”", exact: true })
    .check();
  await page.screenshot({
    path: "artifacts/luma-onboarding-mobile.png",
    fullPage: true,
  });
  await audit(page);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Prefer audible crossings", { exact: false }).check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByRole("button", { name: "High contrast", exact: false })
    .click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Use Luma", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Where to?", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Where to?", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Directions", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "Clock “Toward 2 o’clock”", exact: true }),
  ).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "contrast");
});

test("mobile home and settings match the visual layout with accessible themes", async ({
  page,
}) => {
  await boot(page);
  await expect(
    page.getByRole("button", { name: "Say where to go", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/luma-home-mobile.png",
    fullPage: true,
  });
  await audit(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Faster", exact: true }).click();
  await expect(page.locator("output")).toHaveText("1.1×");
  await page.screenshot({
    path: "artifacts/luma-settings-mobile.png",
    fullPage: true,
  });
  await audit(page);
  await page.getByRole("button", { name: "Display", exact: true }).click();
  for (const theme of [
    "Red–green friendly",
    "Blue–yellow friendly",
    "High contrast",
    "Luma",
  ]) {
    await page.getByRole("button", { name: theme, exact: false }).click();
    await audit(page);
  }
  await page.getByLabel("Larger text", { exact: false }).check();
  await page.setViewportSize({ width: 320, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("desktop retains map icons and computes different preferred routes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page, 1440, 1000);
  await expect(page.locator(".map-shell")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 45000 },
  );
  await expect
    .poll(async () =>
      Number(await page.locator(".map").getAttribute("data-visible-points")),
    )
    .toBeGreaterThan(0);
  await page.screenshot({
    path: "artifacts/luma-home-desktop.png",
    fullPage: true,
  });
  await tryWalk(page);
  await expect(page.locator(".route-hero")).toContainText("Fastest walk");
  await expect(page.locator(".route-hero>p")).toHaveText("17 min");
  await page.getByRole("button", { name: "Edit journey", exact: true }).click();
  await page.getByText("Crossing preferences", { exact: true }).click();
  await page.getByLabel("Prefer audible crossings", { exact: false }).check();
  const responsePromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/routes") &&
      r.request().postDataJSON().prefer_audible === true,
  );
  await page.getByRole("button", { name: "Find routes", exact: true }).click();
  const data = await (await responsePromise).json();
  expect(data.routes[0].coordinates).not.toEqual(data.routes[1].coordinates);
  await expect(page.locator(".route-hero")).toContainText(
    "Accessibility preferences",
  );
  await page.screenshot({
    path: "artifacts/luma-route-desktop.png",
    fullPage: true,
  });
  await audit(page);
  await page.getByRole("button", { name: "Next route", exact: true }).click();
  await expect(page.locator(".route-hero")).toContainText("Fastest walk");
  expect(errors).toEqual([]);
});

test("endpoint validity, swapping and saved places preserve confirmed coordinates", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page);
  await page.getByRole("button", { name: "Routes", exact: true }).click();
  const startInput = page.getByRole("combobox", { name: "From", exact: true });
  await startInput.fill("zzzz-no-matching-place");
  await expect(
    page.getByRole("status").filter({ hasText: "No matching places" }),
  ).toBeVisible();
  await startInput.press("ArrowUp");
  await startInput.press("Enter");
  await expect(
    page.getByRole("button", { name: "Find routes", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("combobox", { name: "From", exact: true })
    .fill("Royal Ontario");
  await expect(
    page.getByRole("button", { name: "Find routes", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("option")
    .filter({ hasText: "Royal Ontario Museum" })
    .click();
  await page
    .getByRole("button", { name: "Swap start and destination", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "To", exact: true }),
  ).toHaveValue("Royal Ontario Museum");
  await page
    .getByRole("button", { name: "Save destination", exact: true })
    .click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await expect(page.locator(".saved-place")).toContainText(
    "Royal Ontario Museum",
  );
  await page
    .getByRole("button", { name: "Remove Royal Ontario Museum", exact: true })
    .click();
  await expect(page.locator(".saved-place")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("navigation, actual crossing state and reporting keep the current route step", async ({
  page,
}) => {
  await boot(page);
  await tryWalk(page);
  await page.screenshot({
    path: "artifacts/luma-route-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Preview route 1", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const before = await page.locator(".preview-badge").innerText();
  await page.getByRole("button", { name: "What’s next", exact: false }).click();
  await expect(page.locator(".preview-badge")).toHaveText(before);
  await page.screenshot({
    path: "artifacts/luma-navigation-mobile.png",
    fullPage: true,
  });
  await audit(page);
  for (let i = 0; i < 20; i++) {
    if (
      await page
        .getByRole("region", { name: "At the crossing", exact: true })
        .count()
    )
      break;
    await page
      .getByRole("button", { name: "Next preview step", exact: false })
      .click();
  }
  await expect(
    page.getByRole("region", { name: "At the crossing", exact: true }),
  ).toBeVisible();
  const crossingStep = await page.locator(".preview-badge").innerText();
  await expect(page.locator(".crossing-caution")).toContainText(
    "Check traffic",
  );
  await page.screenshot({
    path: "artifacts/luma-crossing-mobile.png",
    fullPage: true,
  });
  await audit(page);
  await page
    .getByRole("button", { name: "Report a problem", exact: true })
    .click();
  await page.screenshot({
    path: "artifacts/luma-report-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Signal silent", exact: true })
    .click();
  await expect(
    page.locator(".helper").filter({ hasText: "route-preview position" }),
  ).toBeVisible();
  await page
    .getByLabel("What happened?", { exact: false })
    .fill("Prototype test: no sound after pressing the button.");
  const saving = page.waitForResponse(
    (r) => r.url().endsWith("/api/reports") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  const response = await saving;
  expect(response.status()).toBe(201);
  const report = await response.json();
  expect(report.location_source).toBe("route_preview");
  expect(report.status).toBe("unverified");
  await expect(
    page.getByRole("heading", { name: "Report saved", exact: true }),
  ).toBeVisible();
  await audit(page);
  const stored = await page.request.get("/api/reports/" + report.id);
  expect((await stored.json()).notes).toContain("Prototype test");
  await page
    .getByRole("button", { name: "Back to route", exact: true })
    .click();
  await expect(page.locator(".preview-badge")).toHaveText(crossingStep);
  await page.getByRole("button", { name: "End route", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Preview route 1", exact: true }),
  ).toBeFocused();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Privacy", exact: true }).click();
  await page
    .getByText("Reports saved from this device (1)", { exact: true })
    .click();
  await expect(page.locator(".report-history")).toContainText("Signal silent");
  await page
    .getByRole("button", {
      name: "Delete report " + report.id.slice(0, 8),
      exact: true,
    })
    .click();
  await expect(page.locator(".report-history article")).toHaveCount(0);
  expect((await page.request.get("/api/reports/" + report.id)).status()).toBe(
    404,
  );
});

test("report form supports changed locations and voice fallback", async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    delete (window as any).SpeechRecognition;
    delete (window as any).webkitSpeechRecognition;
  });
  await page.getByRole("button", { name: "Report", exact: true }).click();
  await page
    .getByRole("button", { name: "Say what’s wrong", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Voice input is unavailable",
  );
  await page
    .getByRole("combobox", { name: "Report location", exact: true })
    .fill("Royal Ontario");
  await expect(
    page.getByRole("button", { name: "Save report", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("option")
    .filter({ hasText: "Royal Ontario Museum" })
    .click();
  await expect(
    page.getByRole("button", { name: "Save report", exact: true }),
  ).toBeEnabled();
  await audit(page);
});

test("scheduled buses retain boarding directions and render on the unchanged map", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "Routes", exact: true }).click();
  await page
    .getByRole("combobox", { name: "To", exact: true })
    .fill("Royal Ontario");
  await page
    .getByRole("option")
    .filter({ hasText: "Royal Ontario Museum" })
    .click();
  await page.getByRole("button", { name: "Bus + walk", exact: true }).click();
  await page
    .getByLabel("Leave at (Toronto time)", { exact: false })
    .fill("2026-11-07T12:00");
  await page.getByRole("button", { name: "Find routes", exact: true }).click();
  await expect(page.locator(".route-hero")).toContainText("Scheduled arrival", {
    timeout: 65000,
  });
  await page.locator(".itinerary summary").click();
  await expect(page.locator(".itinerary")).toContainText("Board bus");
  await expect(page.locator(".itinerary")).toContainText("Get off at");
  await audit(page);
  await page
    .getByRole("button", { name: "Show route on map", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        Number(
          await page
            .locator(".map")
            .getAttribute("data-visible-route-segments"),
        ),
      { timeout: 15000 },
    )
    .toBeGreaterThan(0);
  await page.screenshot({
    path: "artifacts/luma-bus-map-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  for (let i = 0; i < 4; i++) {
    if (
      (await page.locator(".route-hero").innerText()).includes(
        "Walking alternative",
      )
    )
      break;
    await page.getByRole("button", { name: "Next route", exact: true }).click();
  }
  await expect(page.locator(".route-hero")).toContainText(
    "Walking alternative",
  );
});

test("a delayed response cannot overwrite an edited journey", async ({
  page,
}) => {
  let release: () => void = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  let seen: () => void = () => {};
  const first = new Promise<void>((r) => {
    seen = r;
  });
  await page.route("**/api/routes", async (r) => {
    const response = await r.fetch();
    if (r.request().postDataJSON().end_name === "Nathan Phillips Square") {
      seen();
      await held;
    }
    await r.fulfill({ response });
  });
  await boot(page);
  await page
    .getByRole("button", { name: "Example journey Try a walk" })
    .click();
  await first;
  await page.getByRole("button", { name: "Edit journey", exact: true }).click();
  await page
    .getByRole("combobox", { name: "To", exact: true })
    .fill("Royal Ontario");
  await page
    .getByRole("option")
    .filter({ hasText: "Royal Ontario Museum" })
    .click();
  await page.getByRole("button", { name: "Find routes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Preview route 1", exact: true }),
  ).toBeVisible();
  const old = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/routes") &&
      r.request().postDataJSON().end_name === "Nathan Phillips Square",
  );
  release();
  await old;
  await page.locator(".itinerary summary").click();
  await expect(page.locator(".itinerary")).toContainText(
    "Arrive near Royal Ontario Museum",
  );
});
