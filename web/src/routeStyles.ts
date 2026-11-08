import type { Route } from "./model";

// Assign styles once per response so selection never changes a route's identity.
export function withRouteStyles(routes: Route[]): Route[] {
  const options = routes.slice(0, 3);
  let accessible = options.findIndex(r => /accessibility preferences|accessible route/i.test(r.name));
  let fastest = options.findIndex(r => /fastest|earliest bus/i.test(r.name));
  const coverage = (r: Route) => r.crossings ? (r.audible + r.tactile) / r.crossings : 2;
  if (accessible < 0) {
    // Compare documented crossing coverage when no preference route is named.
    const candidates = options.map((r, i) => ({ r, i })).filter(x => x.i !== fastest);
    candidates.sort((a, b) => coverage(b.r) - coverage(a.r) || a.r.crossings - b.r.crossings);
    accessible = candidates[0]?.i ?? -1;
  }
  if (fastest < 0) {
    const candidates = options.map((r, i) => ({ r, i })).filter(x => x.i !== accessible);
    candidates.sort((a, b) => a.r.duration_seconds - b.r.duration_seconds);
    fastest = candidates[0]?.i ?? -1;
  }
  return options.map((r, i) => ({ ...r, style_rank: i === accessible ? 0 : i === fastest ? 1 : 2 }));
}
export function routeColors(theme: string): string[] {
  return (
    (
      {
        "red-green": ["#0072B2", "#E69F00", "#17212F"],
        "blue-yellow": ["#9B3658", "#254653", "#F0F0EB"],
        contrast: ["#000000", "#FFD600", "#FFFFFF"],
      } as Record<string, string[]>
    )[theme] || ["#5865F2", "#FF8A4C", "#2CCBA8"]
  );
}
export function routeFeatures(
  routes: Route[],
  selected: number,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: routes.slice(0, 3).flatMap((route, index) =>
      route.segments
        .filter((segment) => segment.coordinates.length > 1)
        .map((segment) => ({
          type: "Feature" as const,
          properties: {
            mode: segment.mode,
            routeIndex: index,
            rank: route.style_rank ?? index,
            emphasized: index === selected,
          },
          geometry: {
            type: "LineString" as const,
            coordinates: segment.coordinates,
          },
        })),
    ),
  };
}
