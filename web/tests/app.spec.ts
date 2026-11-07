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
    page.getByRole("button", { name: "Say where to go", exact: true }),
  ).toBeVisible();
  await expect(page.locator('#panel')).toHaveAttribute('data-loaded','true',{timeout:30000});
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
  await expect(page.locator('.nearby-details')).toHaveCount(0);
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
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await page
    .getByRole("button", { name: "High contrast", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "contrast");
  expect(errors).toEqual([]);
});
test("phone layout and accessibility", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator('#panel')).toHaveAttribute('data-loaded','true',{timeout:30000});
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
test("destination search and simplified home", async ({ page }) => {
  await page.goto("/");
  await page.getByRole('button',{name:'Type',exact:true}).click();
  await page
    .getByRole("textbox", { name: "Search a destination or intersection" })
    .fill("Union");
  await expect(page.locator(".search-results button").first()).toContainText(
    "Union",
  );
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.locator('.nearby-details')).toHaveCount(0);
});

test('focused phone navigation and grouped settings', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.getByRole('button',{name:'Try a walk',exact:true}).click();
  await page.getByRole('button',{name:'Preview walk',exact:true}).click();
  const navigation=page.getByRole('region',{name:'Simulated walk'});
  await expect(navigation).toBeVisible();
  await expect(page.locator('.panel')).toBeHidden();
  await expect(page.locator('.rail')).toBeHidden();
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.screenshot({path:'artifacts/luma-transit-mobile.png',fullPage:true});
  expect((await new AxeBuilder({page}).analyze()).violations.filter(v=>['serious','critical'].includes(v.impact||''))).toEqual([]);
  await page.getByRole('button',{name:'Where am I?',exact:true}).click();
  await expect(navigation.locator('.spoken-strip')).toContainText('Simulated position');
  await page.getByRole('button',{name:'End',exact:true}).click();
  await expect(page.getByRole('button',{name:'Preview walk',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByRole('button',{name:'Display',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'High contrast',exact:true})).toBeHidden();
  await page.screenshot({path:'artifacts/luma-settings-mobile.png',fullPage:true});
});
