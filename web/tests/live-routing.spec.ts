import { test, expect } from "@playwright/test";
import type { Route, Coord } from "../src/model";

const coords: Coord[] = [
  [-79.383, 43.65],
  [-79.383, 43.656],
  [-79.375, 43.656],
];
function journey(
  mode: "walk" | "transit",
  revision: string,
  minutes: number,
): Route {
  return {
    id: "0",
    name: mode === "walk" ? "Fastest walk" : "Earliest TTC arrival",
    mode,
    minutes,
    duration_seconds: minutes * 60,
    distance: 1000,
    crossings: 2,
    audible: 1,
    tactile: 0,
    coordinates: coords,
    segments: [{ mode: "walk", coordinates: coords }],
    steps: [
      {
        kind: "walk",
        title: "Walk north",
        text: "Walk north.",
        distance: 1000,
        crossing: false,
        coordinates: coords[0],
      },
    ],
    snap_distances: [0, 0],
    departure_time: "2026-11-08T00:00:00-05:00",
    arrival_time: "2026-11-08T00:10:00-05:00",
    timing: mode === "walk" ? "estimated" : "mixed",
    explanation: "",
    construction_revision: revision,
    construction_available: true,
    pednet_ids: ["edge-1"],
    ...(mode === "transit"
      ? {
          walking_minutes: 2,
          waiting_minutes: 3,
          riding_minutes: 5,
          transfers: 0,
          bus_legs: [
            {
              route: "10",
              mode: "bus",
              route_id: "surface:10",
              direction_id: "1",
              headsign: "East to Victoria Park",
              from_stop: "surface:a",
              to_stop: "surface:b",
              from_name: "Start stop",
              to_name: "Exit stop",
              departure_time: "2026-11-08T00:03:00-05:00",
              arrival_time: "2026-11-08T00:08:00-05:00",
              stops: 4,
            },
          ],
        }
      : {}),
  };
}

async function prepare(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.clock.install({ time: new Date("2026-11-08T05:00:00Z") });
  await page.addInitScript(() => {
    localStorage.setItem("luma-screenReader", "true");
    localStorage.setItem("luma-sounds", "false");
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
  await page.goto("/");
  await page.getByRole("button", { name: "Try Luma", exact: true }).click();
  for (let i = 0; i < 4; i++)
    await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Use Luma", exact: true }).click();
}

test("transit arrivals match direction and refresh without interrupting route selection", async ({
  page,
}) => {
  let routeCalls = 0,
    arrivalCalls = 0;
  await page.route("**/api/conditions**", (r) =>
    r.fulfill({
      json: {
        type: "FeatureCollection",
        features: [],
        revision: "open",
        available: true,
        complete: true,
        stale: false,
      },
    }),
  );
  await page.route("**/api/routes", (r) => {
    routeCalls++;
    const mode =
      r.request().postDataJSON().mode === "transit" ? "transit" : "walk";
    return r.fulfill({
      json: { routes: [journey(mode, "open", routeCalls > 1 ? 12 : 10)] },
    });
  });
  await page.route("**/api/transit/arrivals?**", (r) => {
    arrivalCalls++;
    return r.fulfill({
      json: {
        stops: [
          {
            id: "surface:a",
            name: "Start stop",
            arrivals: [
              {
                trip: "1",
                route_id: "surface:10",
                route: "10",
                mode: "bus",
                direction_id: "1",
                headsign: "East to Victoria Park",
                minutes: arrivalCalls > 1 ? 1 : 2,
                arrival_time: "2026-11-08T00:02:00-05:00",
                timing: "real-time",
              },
              {
                trip: "2",
                route_id: "surface:10",
                route: "10",
                mode: "bus",
                direction_id: "0",
                headsign: "Wrong westbound direction",
                minutes: 1,
                arrival_time: "2026-11-08T00:01:00-05:00",
                timing: "real-time",
              },
              {
                trip: "3",
                route_id: "surface:10",
                route: "10",
                mode: "bus",
                direction_id: "1",
                headsign: "East to Victoria Park",
                minutes: 10,
                arrival_time: "2026-11-08T00:10:00-05:00",
                timing: "scheduled",
              },
            ],
          },
        ],
      },
    });
  });
  await prepare(page);
  await page.getByRole("button", { name: "Routes", exact: true }).click();
  await page.getByRole("button", { name: "Transit", exact: true }).click();
  await page.getByRole("button", { name: "Find routes", exact: true }).click();
  const arrivals = page.getByRole("region", { name: "Upcoming TTC arrivals" });
  await expect(arrivals.getByText("2 min", { exact: true })).toBeVisible();
  await expect(arrivals.getByText("Live", { exact: true })).toBeVisible();
  await expect(arrivals.getByText("Scheduled", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Wrong westbound direction", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Start stop → Exit stop")).toBeVisible();
  await page.clock.fastForward(31000);
  await expect(arrivals.getByText("1 min", { exact: true })).toBeVisible();
  await expect(page.locator(".route-hero > p")).toHaveText("12 min");
  await expect(page.locator(".luma-loader")).toHaveCount(0);
  expect(routeCalls).toBe(2);
  expect(arrivalCalls).toBe(2);
});

test("new confirmed construction recalculates comparisons in the background", async ({
  page,
}) => {
  let closed = false,
    calls = 0;
  await page.route("**/api/conditions**", (r) =>
    r.fulfill({
      json: {
        type: "FeatureCollection",
        revision: closed ? "closed" : "open",
        available: true,
        complete: true,
        stale: false,
        features: closed
          ? [
              {
                type: "Feature",
                geometry: {
                  type: "LineString",
                  coordinates: coords.slice(0, 2),
                },
                properties: {
                  id: "works",
                  name: "Test closure",
                  street: "Test St",
                  description: "North sidewalk closed.",
                  pedestrian_access: "closed",
                  routing_status: "blocked",
                  active: true,
                  closed_pednet_ids: ["edge-1"],
                },
              },
            ]
          : [],
      },
    }),
  );
  await page.route("**/api/routes", (r) => {
    calls++;
    return r.fulfill({
      json: {
        routes: [journey("walk", closed ? "closed" : "open", closed ? 14 : 10)],
      },
    });
  });
  await prepare(page);
  await page
    .getByRole("button", { name: "Example journey Try a walk", exact: true })
    .click();
  await expect(page.locator(".route-hero > p")).toHaveText("10 min");
  closed = true;
  await page.clock.fastForward(61000);
  await expect(page.locator(".route-hero > p")).toHaveText("14 min");
  await expect(page.locator(".luma-loader")).toHaveCount(0);
  expect(calls).toBe(2);
});
