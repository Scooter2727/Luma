import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { routeColors } from "../src/routeStyles";

const makeRoute = (index: number) => {
  const coordinates = [
    [-79.383, 43.65],
    [
      [-79.383, 43.656],
      [-79.375, 43.65],
      [-79.379, 43.653],
    ][index % 3],
    [-79.375, 43.656],
  ];
  return {
    id: String(index),
    name: ["Accessibility preferences", "Fastest walk", "Alternative walking route"][index % 3],
    mode: "walk",
    minutes: 10 + index,
    distance: 1000 + index * 200,
    crossings: 1,
    audible: 1,
    tactile: 0,
    coordinates,
    snap_distances: [0, 0],
    timing: "estimated",
    departure_time: "2026-11-08T12:00:00-05:00",
    arrival_time: "2026-11-08T12:12:00-05:00",
    duration_seconds: (10 + index) * 60,
    explanation: "",
    segments: [{ mode: "walk", coordinates }],
    steps: [
      {
        kind: "walk",
        title: `Walk route ${index + 1}`,
        text: `Walk route ${index + 1}. Continue along the street.`,
        distance: 1000,
        crossing: false,
        coordinates: coordinates[0],
        bearing: 90,
      },
    ],
  };
};

for (const count of [1, 2, 3])
  for (const theme of ["default", "red-green", "blue-yellow", "contrast"]) {
    test(`${count} routes use accessible patterns and local selection in ${theme}`, async ({
      page,
    }) => {
      const width = count === 2 ? 1440 : 390;
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((theme) => {
        localStorage.setItem("luma-theme", theme);
        localStorage.setItem("luma-screenReader", "true");
        localStorage.setItem("luma-sounds", "false");
      }, theme);
      // Capture the real MapLibre instance only in the served test module.
      await page.route("**/web/src/MapView.tsx*", async (r) => {
        const response = await r.fetch();
        const source = await response.text();
        expect(source).toContain("map.current = m;");
        await r.fulfill({
          response,
          body: source.replace(
            "map.current = m;",
            "map.current = m; window.testMap = m;",
          ),
        });
      });
      await page.route("**/maps/simple.json", (r) =>
        r.fulfill({
          json: {
            version: 8,
            sources: {},
            layers: [
              {
                id: "background",
                type: "background",
                paint: { "background-color": "#eee" },
              },
            ],
          },
        }),
      );
      await page.route("**/api/locations", (r) =>
        r.fulfill({ json: { features: [] } }),
      );
      let requests = 0;
      const routes = Array.from({ length: count === 3 ? 4 : count }, (_, i) =>
        makeRoute(i),
      );
      await page.route("**/api/routes", (r) => {
        requests++;
        return r.fulfill({ json: { routes } });
      });
      await page.goto("/");
      await page.getByRole("button", { name: "Try Luma", exact: true }).click();
      for (let i = 0; i < 4; i++)
        await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.getByRole("button", { name: "Use Luma", exact: true }).click();
      await page
        .getByRole("button", {
          name: "Example journey Try a walk",
          exact: true,
        })
        .click();
      await expect(page.getByRole("heading", { name: `Route 1 of ${count}`, exact: true })).toBeVisible();
      await expect(page.locator(".route-comparison")).toHaveCount(0);
      if (width <= 760) {
        await expect(page.locator(".map-shell")).toBeHidden();
        const panel = await page.locator(".panel").boundingBox();
        expect(panel?.y).toBe(0);
        expect(panel?.height).toBe(900);
      } else {
        await expect(page.locator(".map-shell")).toBeVisible();
      }
      if (count > 1) {
        await page.getByRole("button", { name: "Previous route", exact: true }).click();
        await expect(page.getByRole("heading", { name: `Route ${count} of ${count}`, exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Next route", exact: true }).click();
        await expect(page.getByRole("heading", { name: `Route 1 of ${count}`, exact: true })).toBeVisible();
      }
      await expect(page.locator(".map-shell")).toHaveAttribute(
        "data-ready",
        "true",
      );
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              JSON.parse(
                document
                  .querySelector(".map")!
                  .getAttribute("data-visible-routes") || "[]",
              ).length,
          ),
        )
        .toBe(count);
      const styles = await page.evaluate(() => {
        const m = (window as any).testMap;
        return ["route-line", "route-secondary", "route-third"].map((id) => ({
          color: m.getPaintProperty(id, "line-color"),
          dash: m.getPaintProperty(id, "line-dasharray"),
          cap: m.getLayoutProperty(id, "line-cap"),
        }));
      });
      expect(styles.map((s) => s.color[2])).toEqual(routeColors(theme));
      expect(styles.every((s) => s.color[3] === "#858B94")).toBe(true);
      expect(styles[0].dash).toBeUndefined();
      expect(styles[1].dash).toEqual([3, 2]);
      expect(styles[1].cap).toBe("butt");
      expect(styles[2].dash).toEqual([0.2, 2]);
      expect(styles[2].cap).toBe("round");
      const originalCamera = await page.evaluate(() => {
        const m = (window as any).testMap;
        return [m.getCenter().lng, m.getCenter().lat, m.getZoom()];
      });
      if (count > 1) {
        await page.getByRole("button", { name: "Next route", exact: true }).click();
        await expect(page.getByRole("heading", { name: `Route 2 of ${count}`, exact: true })).toBeVisible();
        await expect(page.locator(".route-hero > p")).toHaveText("11 min");
        await expect
          .poll(() =>
            page.evaluate(
              async () =>
                (
                  await (window as any).testMap.getSource("route").getData()
                ).features.find((f: any) => f.properties.routeIndex === 1)
                  .properties.emphasized,
            ),
          )
          .toBe(true);
        expect(
          await page.evaluate(() => {
            const m = (window as any).testMap;
            return [m.getCenter().lng, m.getCenter().lat, m.getZoom()];
          }),
        ).toEqual(originalCamera);
      }
      if (count === 3) {
        await page.getByRole("button", { name: "Show route on map", exact: true }).click();
        await expect(page.locator(".map-shell")).toBeVisible();
        await expect.poll(() => page.evaluate(() => (window as any).testMap.isMoving())).toBe(false);
        const point = await page.evaluate(() => {
          const m = (window as any).testMap,
            p = m.project([-79.379, 43.653]);
          const box = m.getContainer().getBoundingClientRect();
          return { x: p.x + box.x, y: p.y + box.y };
        });
        await page.mouse.move(point.x, point.y);
        await expect.poll(() => page.evaluate(async () => {
          const features = (await (window as any).testMap.getSource("route").getData()).features;
          return features.map((f: any) => ({ rank: f.properties.rank, emphasized: f.properties.emphasized }));
        })).toEqual([{ rank: 0, emphasized: false }, { rank: 1, emphasized: false }, { rank: 2, emphasized: true }]);
        await page.mouse.move(20, 20);
        await expect.poll(() => page.evaluate(async () => (await (window as any).testMap.getSource("route").getData()).features.find((f: any) => f.properties.routeIndex === 1).properties.emphasized)).toBe(true);
        await page.mouse.click(point.x, point.y);
        await page.getByRole("button", { name: "Back", exact: true }).click();
        await expect(page.locator(".map-shell")).toBeHidden();
        await expect(page.getByRole("heading", { name: "Route 3 of 3", exact: true })).toBeVisible();
        await expect(page.locator(".route-hero > p")).toHaveText("12 min");
      }
      expect(requests).toBe(1);
      if (theme === "default") {
        await page.screenshot({
          path: `artifacts/route-comparison-${count}.png`,
        });
        const audit = await new AxeBuilder({ page }).exclude(".map").analyze();
        expect(
          audit.violations.filter((v) =>
            ["serious", "critical"].includes(v.impact || ""),
          ),
        ).toEqual([]);
      }
      await page
        .getByRole("button", { name: `Preview route ${count}`, exact: true })
        .click();
      await expect(page.locator(".instruction-summary")).toHaveText(
        `Walk route ${count}`,
      );
      await expect
        .poll(() =>
          page.evaluate(
            async () =>
              new Set(
                (
                  await (window as any).testMap.getSource("route").getData()
                ).features.map((f: any) => f.properties.routeIndex),
              ).size,
          ),
        )
        .toBe(1);
    });
  }
