import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("desktop explore, preferences and real route preview", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Luma", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".data-foot")).toContainText(
    "16,746 mapped locations",
    { timeout: 30000 },
  );
  await expect(page.locator(".map-shell")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 45000 },
  );
  await expect
    .poll(
      async () =>
        Number(await page.locator(".map").getAttribute("data-visible-points")),
      { timeout: 30000 },
    )
    .toBeGreaterThan(0);
  await page.screenshot({ path: "artifacts/luma-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "View list" }).click();
  await expect(page.locator(".place-row").first()).toBeVisible();
  await page.getByRole("button", { name: "Try a walk" }).click();
  await expect(page.getByRole("heading", { name: "Your options" })).toBeVisible(
    { timeout: 30000 },
  );
  await page.getByRole("button", { name: "Preview walk" }).click();
  await expect(
    page.getByRole("region", { name: "Simulated walk" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close simulated walk" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "High contrast", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "contrast");
  expect(errors).toEqual([]);
});
test("phone layout and accessibility", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".data-foot")).toContainText(
    "16,746 mapped locations",
    { timeout: 30000 },
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "artifacts/luma-mobile.png", fullPage: true });
  const audit = await new AxeBuilder({ page }).exclude(".map").analyze();
  expect(
    audit.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact || ""),
    ),
  ).toEqual([]);
});
test("search, feature details, and API failures", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Search a destination or intersection" })
    .fill("Union");
  await expect(page.locator(".search-results button").first()).toContainText(
    "Union",
  );
  await page.getByRole("button", { name: "Clear search" }).click();
  await page.locator(".place-row").first().click();
  await expect(
    page.getByRole("heading", { name: "What you’ll find" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View data source" }),
  ).toHaveAttribute("href", /^https:/);
});
