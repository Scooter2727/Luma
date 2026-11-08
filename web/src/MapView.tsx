import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { mapIconImages } from "./mapTheme";
import type { Coord, Feature, Route, Place, Step } from "./model";
import { routeColors, routeFeatures } from "./routeStyles";
import { symbolInk } from "./mapTheme";
maplibregl.setWorkerUrl(mapWorkerUrl);
type Props = {
  decorative?: boolean;
  theme: string;
  data: Feature[];
  active: string[];
  route?: Route;
  alternatives?: Route[];
  selectedIndex?: number;
  onRouteSelect?: (index: number) => void;
  pickMode: "start" | "end" | null;
  onPick: (target: "start" | "end", place: Place) => void;
  onSelect: (feature: Feature) => void;
  focus?: Step | Coord;
  visible: boolean;
};
export default function MapView({
  decorative = false,
  theme,
  data,
  active,
  route,
  alternatives,
  selectedIndex = 0,
  onRouteSelect,
  pickMode,
  onPick,
  onSelect,
  focus,
  visible,
}: Props) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<maplibregl.Map | null>(null),
    markers = useRef<maplibregl.Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [hoveredRoute, setHoveredRoute] = useState<number | null>(null);
  const pickModeRef = useRef(pickMode);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  pickModeRef.current = pickMode;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const selectedRef = useRef(onSelect);
  const routeSelectRef = useRef(onRouteSelect);
  routeSelectRef.current = onRouteSelect;
  const displayRoutes = alternatives?.slice(0, 3) ?? (route ? [route] : []);
  const cameraKey = JSON.stringify(displayRoutes.map((r) => r.coordinates));
  selectedRef.current = (f) => {
    if (!pickModeRef.current) onSelect(f);
  };
  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    const m = new maplibregl.Map({
      container: container.current,
      style: "/maps/simple.json",
      center: [-79.383, 43.652],
      zoom: 14.7,
      minZoom: 8,
      maxZoom: 19,
      attributionControl: false,
    });
    map.current = m;
    m.on("load", async () => {
      let images: Awaited<ReturnType<typeof mapIconImages>>;
      try {
        images = await mapIconImages(themeRef.current);
      } catch {
        return;
      }
      if (disposed) return;
      for (const { id, image } of images)
        m.addImage(id, image, { pixelRatio: 2 });
      m.addSource("locations", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addLayer({
        id: "points",
        minzoom: 14,
        type: "symbol",
        source: "locations",
        layout: {
          "icon-image": ["get", "kind"],
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            12,
            0.72,
            17,
            1.15,
          ],
          "icon-allow-overlap": false,
          "icon-padding": 3,
        },
      });
      m.addSource("route", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      const colors = routeColors(themeRef.current);
      // Fixed route styles; the emphasized route is moved above the others below.
      for (const rank of [2, 1, 0]) {
        const id = ["route-line", "route-secondary", "route-third"][rank];
        const width = [6, 8, 10][rank];
        const dash = rank === 1 ? [3, 2] : rank === 2 ? [0.2, 2] : undefined;
        const filter: maplibregl.FilterSpecification = [
          "==",
          ["get", "rank"],
          rank,
        ];
        const layout: maplibregl.LineLayerSpecification["layout"] = {
          "line-cap": rank === 1 ? "butt" : "round",
          "line-join": "round",
        };
        m.addLayer({
          id: id + "-halo",
          type: "line",
          source: "route",
          filter,
          layout,
          paint: {
            "line-color": ["case", ["get", "emphasized"], symbolInk(colors[rank]), "#F6F6F6"],
            "line-width": width + 1.5,
            ...(dash
              ? {
                  "line-dasharray": dash.map(
                    (value) => (value * width) / (width + 1.5),
                  ),
                }
              : {}),
          },
        });
        m.addLayer({
          id,
          type: "line",
          source: "route",
          filter,
          layout,
          paint: {
            "line-color": ["case", ["get", "emphasized"], colors[rank], "#858B94"],
            "line-width": width,
            ...(dash ? { "line-dasharray": dash } : {}),
          },
        });
      }
      m.on("click", (e) => {
        const target = pickModeRef.current;
        if (!target) {
          if (routeSelectRef.current) {
            const point = e.point;
            const hits = m.queryRenderedFeatures(
              [
                [point.x - 8, point.y - 8],
                [point.x + 8, point.y + 8],
              ],
              { layers: ["route-line", "route-secondary", "route-third"] },
            );
            if (hits[0])
              routeSelectRef.current(Number(hits[0].properties.routeIndex));
          }
          return;
        }
        const place: Place = {
          id: "pin-" + Date.now(),
          name: target === "start" ? "Pinned start" : "Pinned destination",
          subtitle: `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`,
          coordinates: [e.lngLat.lng, e.lngLat.lat],
        };
        pickRef.current(target, place);
      });
      m.on("click", "points", (e) => {
        if (
          routeSelectRef.current &&
          m.queryRenderedFeatures(e.point, {
            layers: ["route-line", "route-secondary", "route-third"],
          }).length
        )
          return;
        const f = e.features?.[0];
        if (f) {
          selectedRef.current(f as unknown as Feature);
          m.easeTo({
            center: (f.geometry as GeoJSON.Point).coordinates as Coord,
            duration: 500,
          });
        }
      });
      m.on(
        "mouseenter",
        "points",
        () => (m.getCanvas().style.cursor = "pointer"),
      );
      m.on("mouseleave", "points", () => (m.getCanvas().style.cursor = ""));
      m.on("mousemove", (e) => {
        if (!routeSelectRef.current || pickModeRef.current) return;
        const hits = m.queryRenderedFeatures(e.point, {
          layers: ["route-line", "route-secondary", "route-third"],
        });
        setHoveredRoute(hits[0] ? Number(hits[0].properties.routeIndex) : null);
        m.getCanvas().style.cursor = hits.length ? "pointer" : "";
      });
      const clearHover = () => setHoveredRoute(null);
      m.getCanvas().addEventListener("mouseleave", clearHover);
      m.on("remove", () => m.getCanvas().removeEventListener("mouseleave", clearHover));
      m.on("idle", () => {
        container.current?.setAttribute(
          "data-visible-route-segments",
          String(
            m.queryRenderedFeatures({
              layers: ["route-line", "route-secondary", "route-third"],
            }).length,
          ),
        );
        container.current?.setAttribute(
          "data-visible-routes",
          JSON.stringify([
            ...new Set(
              m
                .queryRenderedFeatures({
                  layers: ["route-line", "route-secondary", "route-third"],
                })
                .map((f) => Number(f.properties.routeIndex)),
            ),
          ]),
        );
        container.current?.setAttribute(
          "data-visible-points",
          String(m.queryRenderedFeatures({ layers: ["points"] }).length),
        );
      });
      setMapReady(true);
    });

    return () => {
      disposed = true;
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!mapReady || !map.current) return;
    const m = map.current;
    let cancelled = false;
    mapIconImages(theme)
      .then((images) => {
        if (cancelled) return;
        for (const { id, image } of images) m.updateImage(id, image);
        routeColors(theme).forEach((color, rank) => {
          const id = ["route-line", "route-secondary", "route-third"][rank];
          m.setPaintProperty(id, "line-color", ["case", ["get", "emphasized"], color, "#858B94"]);
          m.setPaintProperty(id + "-halo", "line-color", ["case", ["get", "emphasized"], symbolInk(color), "#F6F6F6"]);
        });
        container.current?.setAttribute("data-icon-theme", theme);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [theme, mapReady]);
  useEffect(() => {
    if (mapReady && map.current) {
      (map.current.getSource("locations") as maplibregl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features: data.filter((f) => active.includes(f.properties.kind)),
      } as GeoJSON.FeatureCollection);
    }
  }, [data, active, mapReady]);

  useEffect(() => {
    if (!mapReady || !map.current) return;
    const m = map.current;
    (m.getSource("route") as maplibregl.GeoJSONSource).setData(
      routeFeatures(displayRoutes, alternatives ? (hoveredRoute ?? selectedIndex) : 0),
    );
    const emphasized = displayRoutes[alternatives ? (hoveredRoute ?? selectedIndex) : 0];
    if (emphasized) {
      const rank = emphasized.style_rank ?? (alternatives ? (hoveredRoute ?? selectedIndex) : 0);
      const id = ["route-line", "route-secondary", "route-third"][rank];
      m.moveLayer(id + "-halo");
      m.moveLayer(id);
    }
    markers.current.forEach((x) => x.remove());
    markers.current = [];
    if (route) {
      for (const [c, label] of [
        [route.coordinates[0], "Route start"],
        [route.coordinates.at(-1)!, "Route destination"],
      ] as [Coord, string][]) {
        const el = document.createElement("div");
        el.className = "route-pin";
        el.setAttribute("role", "img");
        el.setAttribute("aria-label", label);
        markers.current.push(
          new maplibregl.Marker({ element: el }).setLngLat(c).addTo(m),
        );
      }
    }
  }, [route, alternatives, selectedIndex, hoveredRoute, mapReady]);
  useEffect(() => { setHoveredRoute(null); }, [selectedIndex, alternatives === undefined]);
  useEffect(() => {
    const m = map.current;
    if (m && mapReady && displayRoutes.length) {
      const b = new maplibregl.LngLatBounds();
      displayRoutes.forEach((r) => r.coordinates.forEach((c) => b.extend(c)));
      m.fitBounds(b, {
        padding:
          window.innerWidth > 760
            ? { top: 70, bottom: 70, left: 500, right: 60 }
            : {
                top: 90,
                bottom: alternatives ? window.innerHeight * 0.54 + 20 : 130,
                left: 35,
                right: 35,
              },
        maxZoom: 16,
      });
    }
  }, [cameraKey, mapReady, visible]);

  useEffect(() => {
    if (!mapReady || !map.current || !focus) return;
    const c = Array.isArray(focus) ? focus : focus.coordinates;
    map.current.easeTo({ center: c, zoom: 17, duration: 500 });
  }, [focus, mapReady]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(() => map.current?.resize());
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (visible) requestAnimationFrame(() => map.current?.resize());
  }, [visible]);
  return (
    <section
      className={"map-shell" + (visible ? " mobile-map-visible" : "")}
      data-ready={mapReady}
      aria-label="Toronto accessibility map"
      aria-hidden={decorative || undefined}
      inert={decorative || (!visible && window.innerWidth <= 760)}
    >
      <div ref={container} className="map" />
    </section>
  );
}
