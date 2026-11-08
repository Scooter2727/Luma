import { test, expect } from "@playwright/test";

for (const top of [44, 59]) {
  test(`full viewport with simulated ${top}px notch inset`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.locator("html").evaluate((el, inset) => {
      el.style.setProperty("--safe-top", `${inset}px`);
      el.style.setProperty("--safe-bottom", "34px");
    }, top);
    const setup = await page.locator(".onboarding").boundingBox();
    expect(setup!.y).toBe(0);
    expect((await page.locator(".setup-header").boundingBox())!.y).toBeGreaterThanOrEqual(top);
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Use Luma", exact: true }).click();
    for (const tab of ["Home", "Routes", "Report", "Settings"]) {
      await page.getByRole("navigation", { name: "Main", exact: true }).getByRole("button", { name: tab, exact: true }).click();
      expect((await page.locator(".panel").boundingBox())!.y).toBe(0);
      expect((await page.locator(".panel .page-header").boundingBox())!.y).toBeGreaterThanOrEqual(top);
    }
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.getByRole("button", { name: "Show map", exact: true }).click();
    const map = await page.locator(".map-shell").boundingBox();
    expect(map!.y).toBe(0);
    expect(map!.width).toBe(390);
    expect(map!.height).toBe(844 - 92 - 34);
    expect((await page.locator(".map-toolbar").boundingBox())!.y).toBeGreaterThanOrEqual(top);
    expect(await page.locator("html").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(232, 237, 233)");
    await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute("content", "black-translucent");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  });
}
