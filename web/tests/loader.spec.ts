import { test, expect } from "@playwright/test";

async function finishOnboarding(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Try Luma", exact: true }).click();
  for (let step = 0; step < 4; step++) {
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  await page.getByRole("button", { name: "Use Luma", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Where to?", exact: true }),
  ).toBeVisible();
}

test("route planning shows the full-screen Luma loader", async ({ page }) => {
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
});

test("searching for a place shows the full-screen Luma loader", async ({
  page,
}) => {
  await page.route("**/api/search?*", () => new Promise(() => {}));
  await page.goto("/");
  await finishOnboarding(page);
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page.getByLabel("Destination").fill("Queen");
  const loader = page
    .getByRole("status")
    .filter({ hasText: "Searching places…" });
  await expect(loader).toBeVisible();
  await expect(loader).toHaveClass(/luma-loader/);
});

for (const theme of [
  { name: "Red–green friendly", fills: ["rgb(230, 159, 0)", "rgb(0, 114, 178)", "rgb(23, 33, 47)"] },
  { name: "Blue–yellow friendly", fills: ["rgb(240, 240, 235)", "rgb(155, 54, 88)", "rgb(37, 70, 83)"] },
  { name: "High contrast", fills: ["rgb(255, 214, 0)", "rgb(0, 0, 0)", "rgb(255, 255, 255)"] },
]) {
  test(`animated loader follows ${theme.name}`, async ({ page }) => {
    await page.route("**/api/locations", r => r.fulfill({ json: { features: [] } }));
    await page.route("**/api/routes", () => new Promise(() => {}));
    await page.goto("/");
    await page.getByRole("button", { name: "Try Luma", exact: true }).click();
    await page.getByRole("button", { name: theme.name, exact: true }).click();
    for (let step = 0; step < 4; step++) await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Use Luma", exact: true }).click();
    await page.getByRole("button", { name: "Example journey Try a walk", exact: true }).click();
    const circles = page.locator(".luma-loader circle");
    await expect(circles).toHaveCount(3);
    expect(await circles.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fill))).toEqual(theme.fills);
    expect(await circles.evaluateAll(nodes => nodes.every(node => getComputedStyle(node).animationName !== "none"))).toBe(true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await circles.evaluateAll(nodes => nodes.every(node => getComputedStyle(node).animationName === "none"))).toBe(true);
  });
}
