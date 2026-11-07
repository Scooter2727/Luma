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
    { timeout: 60000 },
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

test('walking preferences recalculate geometry and endpoint edits cannot reuse stale coordinates',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button',{name:'Try a walk',exact:true}).click();
  await expect(page.locator('.route-card')).toHaveCount(1,{timeout:45000});
  await expect(page.locator('.route-card').first()).toContainText('Fastest walk');
  await page.getByText('Crossing preferences',{exact:true}).click();
  const preferredResponse=page.waitForResponse(r=>r.url().endsWith('/api/routes')&&r.request().method()==='POST'&&r.request().postDataJSON().prefer_audible===true);
  await page.getByLabel('Prefer audible crossings',{exact:true}).check();
  const response=await preferredResponse;const preferred=await response.json();
  expect(preferred.routes).toHaveLength(2);
  expect(preferred.routes[0].coordinates).not.toEqual(preferred.routes[1].coordinates);
  await expect(page.locator('.route-card')).toHaveCount(2);
  await expect(page.locator('.itinerary')).toContainText('Bay');
  await page.screenshot({path:'artifacts/luma-routing-desktop.png',fullPage:true});
  await page.getByRole('combobox',{name:'From',exact:true}).fill('Royal Ontario');
  await expect(page.getByRole('button',{name:'Find routes',exact:true})).toBeDisabled();
  await expect(page.locator('.route-card')).toHaveCount(0);
  const updated=page.waitForResponse(r=>r.url().endsWith('/api/routes')&&r.request().postDataJSON().start_name==='Royal Ontario Museum');
  await page.getByRole('option').filter({hasText:'Royal Ontario Museum'}).click();
  await updated;
  await expect(page.locator('.route-card').first()).toBeVisible({timeout:10000});
  await expect(page.getByRole('combobox',{name:'From',exact:true})).toHaveValue('Royal Ontario Museum');
  await expect(page.getByRole('combobox',{name:'To',exact:true})).toHaveValue('Nathan Phillips Square');
  const swapped=page.waitForResponse(r=>r.url().endsWith('/api/routes')&&r.request().postDataJSON().start_name==='Nathan Phillips Square');
  await page.getByRole('button',{name:'Swap start and destination',exact:true}).click();
  await swapped;
  await expect(page.getByRole('combobox',{name:'To',exact:true})).toHaveValue('Royal Ontario Museum');
  expect(errors).toEqual([]);
});

test('phone bus planning provides scheduled legs, a walking comparison and accessible directions',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button',{name:'Routes',exact:true}).click();
  await page.getByRole('combobox',{name:'To',exact:true}).fill('Royal Ontario');
  await page.getByRole('option').filter({hasText:'Royal Ontario Museum'}).click();
  await page.getByRole('button',{name:'Bus + walk',exact:true}).click();
  await page.getByLabel('Leave at (Toronto time)',{exact:true}).fill('2026-11-07T12:00');
  await page.getByRole('button',{name:'Find routes',exact:true}).click();
  await expect(page.locator('.route-card').first()).toContainText('Scheduled arrival',{timeout:45000});
  await expect(page.locator('.route-card').last()).toContainText('Walking alternative');
  await expect(page.locator('.itinerary')).toContainText('Board bus');
  await expect(page.locator('.itinerary')).toContainText('Get off at');
  await expect.poll(async()=>Number(await page.locator('.map').getAttribute('data-visible-route-segments')),{timeout:15000}).toBeGreaterThan(0);
  await page.locator('.route-card').first().scrollIntoViewIfNeeded();
  await page.screenshot({path:'artifacts/luma-bus-mobile.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect((await new AxeBuilder({page}).exclude('.map').analyze()).violations.filter(v=>['serious','critical'].includes(v.impact||''))).toEqual([]);
  await page.getByRole('button',{name:'Preview journey',exact:true}).click();
  await expect(page.getByRole('region',{name:'Simulated journey'})).toBeVisible();
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  expect(errors).toEqual([]);
});

test('a delayed old response cannot overwrite a newly selected destination',async({page})=>{
  let releaseOld:()=>void=()=>{};
  const held=new Promise<void>(resolve=>{releaseOld=resolve;});
  let firstSeen:()=>void=()=>{};
  const firstRequest=new Promise<void>(resolve=>{firstSeen=resolve;});
  await page.route('**/api/routes',async route=>{
    const data=route.request().postDataJSON();
    const response=await route.fetch();
    if(data.end_name==='Nathan Phillips Square'){firstSeen();await held;}
    await route.fulfill({response});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Try a walk',exact:true}).click();
  await firstRequest;
  await page.getByRole('combobox',{name:'To',exact:true}).fill('Royal Ontario');
  await page.getByRole('option').filter({hasText:'Royal Ontario Museum'}).click();
  await expect(page.locator('.itinerary')).toContainText('Arrive near Royal Ontario Museum',{timeout:15000});
  const oldResponse=page.waitForResponse(r=>r.url().endsWith('/api/routes')&&r.request().postDataJSON().end_name==='Nathan Phillips Square');
  releaseOld();
  await oldResponse;
  await expect(page.locator('.itinerary')).toContainText('Arrive near Royal Ontario Museum');
  await expect(page.getByRole('combobox',{name:'To',exact:true})).toHaveValue('Royal Ontario Museum');
});
