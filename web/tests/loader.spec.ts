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
  await expect(loader.locator(".luma-mark")).toHaveAttribute("aria-hidden", "true");
});

test("searching for a place stays inline and keeps the input focused", async ({
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
  await expect(loader).toHaveCount(1);
  await expect(page.locator(".luma-loader")).toHaveCount(0);
  await expect(page.getByLabel("Destination", { exact: true })).toBeFocused();
  await expect(page.locator(".picker-spinner")).toBeVisible();
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

test("Go back cancels planning and stays on the editable journey form", async ({ page }) => {
  await page.route("**/api/routes", () => new Promise(() => {}));
  await page.route("**/api/locations", r => r.fulfill({ json: { features: [] } }));
  const aborted = page.waitForEvent("requestfailed", { predicate: r => r.url().endsWith("/api/routes") });
  await page.goto("/");
  await finishOnboarding(page);
  await page.getByRole("button", { name: "Example journey Try a walk", exact: true }).click();
  await expect(page.getByRole("button", { name: "Go back", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Go back", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await aborted;
  await expect(page.locator(".luma-loader")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Plan a journey", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Find routes", exact: true })).toBeEnabled();
});

test("Escape cancels inline search and preserves the entered text", async ({ page }) => {
  await page.route("**/api/search?*", () => new Promise(() => {}));
  await page.route("**/api/locations", r => r.fulfill({ json: { features: [] } }));
  await page.goto("/");
  await finishOnboarding(page);
  await page.getByRole("button", { name: "Type", exact: true }).click();
  const input = page.getByLabel("Destination", { exact: true });
  await input.fill("Queen");
  await input.press("Escape");
  await expect(page.locator(".luma-loader")).toHaveCount(0);
  await expect(input).toHaveValue("Queen");
  await expect(input).toBeFocused();
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("typing continues during search and an older result cannot replace newer suggestions", async ({ page }) => {
  await page.route("**/api/locations", r => r.fulfill({ json: { features: [] } }));
  await page.route("**/api/search?*", async r => {
    const q = new URL(r.request().url()).searchParams.get("q") || "";
    await new Promise(resolve => setTimeout(resolve, q === "Queen" ? 100 : 450));
    await r.fulfill({ json: [{ id: q, name: q + " Street", subtitle: "Toronto", coordinates: [-79.38, 43.65] }] }).catch(() => {});
  });
  await page.goto("/");
  await finishOnboarding(page);
  await page.getByRole("button", { name: "Type", exact: true }).click();
  const input = page.getByLabel("Destination", { exact: true });
  const first = page.waitForRequest(r => r.url().includes("/api/search?q=Qu"));
  await input.fill("Qu");
  await first;
  await input.pressSequentially("een", { delay: 30 });
  await expect(input).toHaveValue("Queen");
  await expect(input).toBeFocused();
  await expect(page.locator(".luma-loader")).toHaveCount(0);
  await expect(page.getByRole("option")).toContainText("Queen Street");
  await page.waitForTimeout(500);
  await expect(page.getByRole("option")).toContainText("Queen Street");
  await expect(input).toHaveAttribute("aria-busy", "false");
});

test("Go back leaves the opening loader for the landing screen", async ({ page }) => {
  await page.route("**/api/locations", () => new Promise(() => {}));
  await page.goto("/");
  await finishOnboarding(page);
  await expect(page.getByText("Opening Luma…", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page.locator(".luma-loader")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try Luma", exact: true })).toBeVisible();
});

test("Go back reveals a saving report without submitting a duplicate", async ({ page }) => {
  await page.route("**/api/locations", r => r.fulfill({ json: { features: [] } }));
  await page.route("**/api/reports/status", r => r.fulfill({ json: { enabled: true, reason: null } }));
  let finish!: () => Promise<void>;
  let writes = 0;
  await page.route("**/api/reports", r => new Promise<void>(resolve => {
    writes++;
    finish = async () => {
      const body = r.request().postDataJSON();
      await r.fulfill({ json: { ...body, id: "saved-report", status: "unverified", created_at: new Date().toISOString() } });
      resolve();
    };
  }));
  await page.goto("/");
  await finishOnboarding(page);
  await page.getByRole("button", { name: "Report", exact: true }).click();
  await page.getByRole("button", { name: "Signal silent", exact: true }).click();
  await page.getByLabel("What happened?", { exact: false }).fill("Button is silent");
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page.locator(".luma-loader")).toHaveCount(0);
  await expect(page.getByLabel("What happened?", { exact: false })).toHaveValue("Button is silent");
  await expect(page.getByRole("button", { name: "Saving report…", exact: true })).toBeDisabled();
  expect(writes).toBe(1);
  await finish();
  await expect(page.getByRole("heading", { name: "Report saved", exact: true })).toBeVisible();
});
