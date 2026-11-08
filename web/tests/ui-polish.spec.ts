import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

async function setup(page: Page, width = 1440, height = 1000) {
  await page.setViewportSize({ width, height });
  await page.route("**/api/locations", (r) =>
    r.fulfill({ json: { features: [] } }),
  );
  await page.route("**/api/transit/meta", (r) =>
    r.fulfill({
      json: { service_start: "2026-11-01", service_end: "2026-12-21" },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Try Luma", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Welcome to Luma", exact: true }),
  ).toHaveCount(0);
}
async function reachHome(page: Page, width = 1440, height = 1000) {
  await page.setViewportSize({ width, height });
  await page.route("**/api/locations", (r) =>
    r.fulfill({ json: { features: [] } }),
  );
  await page.route("**/api/transit/meta", (r) =>
    r.fulfill({
      json: { service_start: "2026-11-01", service_end: "2026-12-21" },
    }),
  );
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = "";
      interimResults = false;
      onresult: ((e: unknown) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {}
      stop() {
        this.onend?.();
      }
    }
    const w = window as unknown as {
      SpeechRecognition?: typeof FakeRecognition;
      webkitSpeechRecognition?: typeof FakeRecognition;
    };
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Ask Luma", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Where to?", exact: true }),
  ).toBeVisible();
}
test("desktop setup starts with colours over the map and keeps the map mounted after setup", async ({
  page,
}) => {
  await setup(page);
  await expect(
    page.getByRole("heading", { name: "Colour and display", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".map-shell")).toBeVisible();
  await expect(page.locator(".map-shell")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 45000 },
  );
  expect(
    await page
      .locator(".setup-shell")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgba(0, 0, 0, 0)");
  await page.evaluate(() => {
    (window as any).originalCanvas = document.querySelector(".map canvas");
  });
  await page
    .getByRole("button", { name: "Red–green friendly", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "red-green");
  await page.screenshot({ path: "artifacts/luma-setup-map-desktop.png" });
  await page.getByRole("button", { name: "Skip setup", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Where to?", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.querySelector(".map canvas") ===
        (window as any).originalCanvas,
    ),
  ).toBe(true);
});
test("walking pace is fixed even when an old saved speed exists", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("luma-onboarding-complete", "true");
    localStorage.setItem("luma-walking-speed", "0.8");
  });
  let speed: number | undefined;
  await page.route("**/api/routes", async (r) => {
    speed = r.request().postDataJSON().walking_speed;
    await r.fulfill({
      status: 400,
      json: { detail: "Captured route request" },
    });
  });
  await reachHome(page, 390, 844);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Crossings", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Walking speed", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page
    .getByRole("button", { name: "Example journey Try a walk", exact: true })
    .click();
  await expect.poll(() => speed).toBe(1.2);
  expect(
    await page.evaluate(() => localStorage.getItem("luma-walking-speed")),
  ).toBeNull();
});
test("mobile setup fills the viewport and transitions honour reduced motion", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).transitions = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.classList.contains("setup-body"))
        (window as any).transitions.push(options);
      return animate.call(this, frames, options);
    };
  });
  await setup(page, 390, 844);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    /viewport-fit=cover/,
  );
  const shell = await page.locator(".setup-shell").boundingBox();
  expect(shell!.y).toBe(0);
  expect(shell!.width).toBe(390);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).transitions.some((t: any) => t.duration === 160),
    ),
  ).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    (window as any).transitions = [];
  });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  expect(await page.evaluate(() => (window as any).transitions.length)).toBe(0);
  const audit = await new AxeBuilder({ page }).exclude(".map").analyze();
  expect(
    audit.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact || ""),
    ),
  ).toEqual([]);
  await page.screenshot({ path: "artifacts/luma-setup-mobile-polish.png" });
});
