import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { mapIconImages, mapPalette } from "./mapTheme";
import type { Coord, Feature, Route, Place, Step } from "./model";
maplibregl.setWorkerUrl(mapWorkerUrl);
type Props = {
  decorative?: boolean;
  theme: string;
  data: Feature[];
  active: string[];
  route?: Route;
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
  const pickModeRef = useRef(pickMode);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  pickModeRef.current = pickMode;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const selectedRef = useRef(onSelect);
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
      minZoom: 10,
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
      m.addLayer({
        id: "route-halo",
        type: "line",
        source: "route",
        paint: { "line-color": "white", "line-width": 10 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      m.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        filter: ["!=", ["get", "mode"], "connect"],
        paint: {
          "line-color": ["match", ["get", "mode"], "bus", "#b04d16", "#5865F2"],
          "line-width": 5,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      m.addLayer({
        id: "route-connect",
        type: "line",
        source: "route",
        filter: ["==", ["get", "mode"], "connect"],
        paint: {
          "line-color": "#5865F2",
          "line-width": 4,
          "line-dasharray": [1, 2],
        },
      });
      m.on("click", (e) => {
        const target = pickModeRef.current;
        if (!target) return;
        const place: Place = {
          id: "pin-" + Date.now(),
          name: target === "start" ? "Pinned start" : "Pinned destination",
          subtitle: `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`,
          coordinates: [e.lngLat.lng, e.lngLat.lat],
        };
        pickRef.current(target, place);
      });
      m.on("click", "points", (e) => {
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
      m.on("idle", () => {
        container.current?.setAttribute(
          "data-visible-route-segments",
          String(m.queryRenderedFeatures({ layers: ["route-line"] }).length),
        );
        container.current?.setAttribute(
          "data-visible-points",
          String(
            m.queryRenderedFeatures({ layers: ["points"] }).length,
          ),
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
        const palette = mapPalette(theme);
        for (const { id, image } of images) m.updateImage(id, image);
        m.setPaintProperty("route-halo", "line-color", palette.halo);
        m.setPaintProperty("route-line", "line-color", [
          "match",
          ["get", "mode"],
          "bus",
          palette.bus,
          palette.walk,
        ]);
        m.setPaintProperty("route-connect", "line-color", palette.walk);
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
    (m.getSource("route") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: route
        ? route.segments
            .filter((s) => s.coordinates.length > 1)
            .map((s) => ({
              type: "Feature" as const,
              properties: { mode: s.mode },
              geometry: {
                type: "LineString" as const,
                coordinates: s.coordinates,
              },
            }))
        : [],
    });
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
      const b = new maplibregl.LngLatBounds();
      route.coordinates.forEach((c) => b.extend(c));
      m.fitBounds(b, {
        padding:
          window.innerWidth > 760
            ? { top: 70, bottom: 70, left: 500, right: 60 }
            : { top: 110, bottom: 130, left: 35, right: 35 },
        maxZoom: 16,
      });
    }
  }, [route, mapReady]);

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
