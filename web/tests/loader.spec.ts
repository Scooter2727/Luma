import { test, expect } from "@playwright/test";

async function finishOnboarding(page: import("@playwright/test").Page) {
  for (let step = 0; step < 4; step++) {
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  await page.getByRole("button", { name: "Use Luma", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Where to?", exact: true }),
  ).toBeVisible();
}

test("route planning shows the Luma loader and keeps the slow-network note", async ({
  page,
}) => {
  await page.route("**/api/routes", () => new Promise(() => {}));
  await page.goto("/");
  await finishOnboarding(page);
  await page
    .getByRole("button", { name: "Example journey Try a walk" })
    .click();
  const loader = page
    .getByRole("status")
    .filter({ hasText: "Finding your way…" });
  await expect(loader).toBeVisible();
  await expect(loader.locator("svg")).toHaveAttribute("aria-hidden", "true");
  await expect(
    page.getByText("The first journey can take longer"),
  ).toBeVisible();
});
