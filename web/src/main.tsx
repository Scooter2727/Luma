import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as maplibregl from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import {
  Search,
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  Navigation,
  LocateFixed,
  SlidersHorizontal,
  Volume2,
  Footprints,
  Bus,
  Library,
  MapPin,
  TrafficCone,
  Layers,
  X,
  Check,
  ChevronRight,
  Play,
  Pause,
  RotateCcw,
  Headphones,
  Compass,
  Route as RouteIcon,
  ExternalLink,
  Accessibility,
  Grid2X2,
} from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import "./contrast.css";
maplibregl.setWorkerUrl(mapWorkerUrl);
type Coord = [number, number];
type Place = { id: string; name: string; subtitle: string; coordinates: Coord };
type Feature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: Coord };
  properties: Record<string, string>;
};
type Route = {
  id: string;
  name: string;
  coordinates: Coord[];
  distance: number;
  minutes: number;
  crossings: number;
  audible: number;
  steps: {
    text: string;
    coordinates: Coord;
    distance: number;
    crossing: boolean;
  }[];
  snap_distances: number[];
};
const kinds = [
  {
    id: "signal",
    name: "Audible signals",
    short: "Audible signal",
    color: "#5865F2",
    icon: Volume2,
  },
  {
    id: "tactile",
    name: "Tactile paving",
    short: "Tactile paving",
    color: "#16856e",
    icon: Grid2X2,
  },
  {
    id: "transit",
    name: "Transit stops",
    short: "Transit stop",
    color: "#b04d16",
    icon: Bus,
  },
  {
    id: "library",
    name: "Libraries",
    short: "Library",
    color: "#9255bb",
    icon: Library,
  },
  {
    id: "station",
    name: "Station features",
    short: "Station feature",
    color: "#297da8",
    icon: Navigation,
  },
  {
    id: "place",
    name: "Other support",
    short: "Support location",
    color: "#96506c",
    icon: Accessibility,
  },
];
const initialStart: Place = {
  id: "union",
  name: "Union Station",
  subtitle: "Front Street West",
  coordinates: [-79.3806, 43.6453],
};
const initialEnd: Place = {
  id: "city-hall",
  name: "Nathan Phillips Square",
  subtitle: "100 Queen Street West",
  coordinates: [-79.3832, 43.6525],
};
function saved<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem("luma-" + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
const icons: Record<string, string> = {
  signal: '<path d="M8 10H5v4h3l4 3V7z M15 9q5 3 0 6 M17 6q9 6 0 12"/>',
  tactile:
    '<path d="M7 6h.01M12 6h.01M17 6h.01M7 12h.01M12 12h.01M17 12h.01M7 18h.01M12 18h.01M17 18h.01" stroke-width="3"/>',
  transit:
    '<rect x="5" y="4" width="14" height="15" rx="3"/><path d="M5 11h14M8 19v2M16 19v2M8 15h.01M16 15h.01"/>',
  library: '<path d="M3 5q5-2 9 1 4-3 9-1v14q-5-2-9 1-4-3-9-1zM12 6v14"/>',
  station: '<path d="m12 3 8 17-8-4-8 4z"/>',
  place: '<circle cx="12" cy="8" r="3"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/>',
};
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const r = await fetch(url, options);
  if (!r.ok) {
    let message = "Unable to connect. Please try again.";
    try {
      message = (await r.json()).detail || message;
    } catch {}
    throw Error(message);
  }
  return r.json();
}
function App() {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<maplibregl.Map | null>(null),
    markers = useRef<maplibregl.Marker[]>([]);
  const [data, setData] = useState<Feature[]>([]),
    [loaded, setLoaded] = useState(false),
    [mapReady, setMapReady] = useState(false),
    [mapError, setMapError] = useState(false);
  const [active, setActive] = useState(kinds.map((k) => k.id)),
    [view, setView] = useState<"explore" | "routes" | "settings">("explore"),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<Place[]>([]),
    [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Feature | null>(null),
    [start, setStart] = useState(initialStart),
    [end, setEnd] = useState(initialEnd),
    [routes, setRoutes] = useState<Route[]>([]),
    [routeIndex, setRouteIndex] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [theme, setTheme] = useState(
      () => localStorage.getItem("luma-theme") || "default",
    ),
    [audible, setAudible] = useState(() => saved("audible", true)),
    [fewer, setFewer] = useState(() => saved("fewer", false)),
    [rate, setRate] = useState(() => saved("rate", 1)),
    [screenReader, setScreenReader] = useState(() =>
      saved("screenReader", false),
    ),
    [large, setLarge] = useState(() => saved("large", false)),
    [list, setList] = useState(false),
    [bounds, setBounds] = useState([-79.405, 43.64, -79.365, 43.665]);
  const [sim, setSim] = useState(false),
    [playing, setPlaying] = useState(false),
    [step, setStep] = useState(0);
  const selectedRef = useRef(setSelected);
  selectedRef.current = setSelected;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("luma-theme", theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.classList.toggle("large-text", large);
  }, [large]);
  useEffect(() => {
    for (const [k, v] of Object.entries({
      audible,
      fewer,
      rate,
      screenReader,
      large,
    }))
      localStorage.setItem("luma-" + k, JSON.stringify(v));
  }, [audible, fewer, rate, screenReader, large]);
  useEffect(() => {
    request<{ features: Feature[] }>("/api/locations")
      .then((d) => {
        setData(d.features);
        setLoaded(true);
      })
      .catch((e) => {
        setError(e.message + " Start the FastAPI server to load locations.");
        setLoaded(true);
      });
  }, []);
  useEffect(() => {
    if (!container.current) return;
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
      for (const k of kinds) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 40 40"><circle cx="20" cy="21" r="18" fill="#17212f" opacity=".12"/><circle cx="20" cy="19" r="17" fill="white"/><circle cx="20" cy="19" r="14" fill="${k.color}"/><g transform="translate(8 7)" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[k.id]}</g></svg>`;
        const im = new Image();
        im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
        await new Promise<void>((resolve) => {
          im.onload = () => resolve();
          im.onerror = () => resolve();
        });
        if (im.complete && im.naturalWidth)
          m.addImage(k.id, im, { pixelRatio: 2 });
      }
      m.addSource("locations", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterMaxZoom: 13,
        clusterRadius: 50,
      });
      m.addLayer({
        id: "clusters",
        type: "circle",
        source: "locations",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#5865F2",
          "circle-radius": 15,
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 3,
        },
      });
      m.addLayer({
        id: "cluster-counts",
        type: "symbol",
        source: "locations",
        filter: ["has", "point_count"],
        layout: {"text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Regular"], "text-size": 13},
        paint: {"text-color": "#ffffff"},
      });
      m.addLayer({
        id: "points",
        type: "symbol",
        source: "locations",
        filter: ["!", ["has", "point_count"]],
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
        paint: { "line-color": "#5865F2", "line-width": 5 },
        layout: { "line-cap": "round", "line-join": "round" },
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
      m.on("click", "clusters", async (e) => {
        const f = e.features?.[0];
        if (f) {
          const zoom = await (
            m.getSource("locations") as maplibregl.GeoJSONSource
          ).getClusterExpansionZoom(Number(f.properties.cluster_id));
          m.easeTo({
            center: (f.geometry as GeoJSON.Point).coordinates as Coord,
            zoom,
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
          "data-visible-points",
          String(
            m.queryRenderedFeatures({ layers: ["points", "clusters"] }).length,
          ),
        );
      });
      setMapReady(true);
    });
    m.on("moveend", () => {
      const b = m.getBounds();
      setBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    });
    let failures = 0;
    m.on("error", () => {
      if (++failures > 4) setMapError(true);
    });
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (mapReady && map.current) {
      (map.current.getSource("locations") as maplibregl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features: data.filter((f) => active.includes(f.properties.kind)),
      } as GeoJSON.FeatureCollection);
    }
  }, [data, active, mapReady]);
  const route = routes[routeIndex];
  useEffect(() => {
    if (!mapReady || !map.current) return;
    const m = map.current;
    (m.getSource("route") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: route
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: route.coordinates },
            },
          ]
        : [],
    });
    markers.current.forEach((x) => x.remove());
    markers.current = [];
    if (route) {
      for (const [c, label] of [
        [route.coordinates[0], "A"],
        [route.coordinates.at(-1)!, "B"],
      ] as [Coord, string][]) {
        const el = document.createElement("div");
        el.className = "route-pin";
        el.textContent = label;
        markers.current.push(
          new maplibregl.Marker({ element: el }).setLngLat(c).addTo(m),
        );
      }
      const b = new maplibregl.LngLatBounds();
      route.coordinates.forEach((c) => b.extend(c));
      m.fitBounds(b, { padding: 80, maxZoom: 16 });
    }
  }, [route, mapReady]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (query.trim()) {
        setSearching(true);
        request<Place[]>("/api/search?q=" + encodeURIComponent(query))
          .then(setResults)
          .catch((e) => setError(e.message))
          .finally(() => setSearching(false));
      } else setResults([]);
    }, 200);
    return () => clearTimeout(t);
  }, [query]);
  function speak(text: string) {
    setNotice(text);
    if (!screenReader && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate;
      window.speechSynthesis.speak(u);
    }
  }
  useEffect(() => {
    if (sim && route) {
      speak(route.steps[step].text);
      map.current?.easeTo({
        center: route.steps[step].coordinates,
        zoom: 17,
        duration: 700,
      });
    }
  }, [step, sim]);
  useEffect(() => {
    if (!playing || !route) return;
    const t = setTimeout(
      () => {
        if (step < route.steps.length - 1) setStep((s) => s + 1);
        else setPlaying(false);
      },
      Math.max(6000, (route.steps[step].text.length * 75) / rate),
    );
    return () => clearTimeout(t);
  }, [playing, step, route, rate]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  function locate() {
    if (!navigator.geolocation) {
      setError("Location is unavailable in this browser.");
      return;
    }
    setNotice("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const c: Coord = [p.coords.longitude, p.coords.latitude];
        setStart({
          id: "current",
          name: "Your location",
          subtitle: `Accuracy approximately ${Math.round(p.coords.accuracy)} metres`,
          coordinates: c,
        });
        map.current?.flyTo({ center: c, zoom: 16 });
        setNotice(
          `Location found. Accuracy approximately ${Math.round(p.coords.accuracy)} metres.`,
        );
      },
      () =>
        setError(
          "Location access is unavailable. You can use Union Station as your starting point.",
        ),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }
  async function plan(destination?: Place) {
    const target = destination || end;
    setEnd(target);
    setView("routes");
    setSelected(null);
    setQuery("");
    setSim(false);
    setPlaying(false);
    setBusy(true);
    setError("");
    setRoutes([]);
    try {
      const d = await request<{ routes: Route[]; notice: string }>(
        "/api/routes",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            start: start.coordinates,
            end: target.coordinates,
            prefer_audible: audible,
            fewer_crossings: fewer,
          }),
        },
      );
      setRoutes(d.routes);
      setRouteIndex(0);
      setNotice(
        `${d.routes.length} route option${d.routes.length === 1 ? "" : "s"} found.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const visible = data.filter(
    (f) =>
      active.includes(f.properties.kind) &&
      f.geometry.coordinates[0] >= bounds[0] &&
      f.geometry.coordinates[0] <= bounds[2] &&
      f.geometry.coordinates[1] >= bounds[1] &&
      f.geometry.coordinates[1] <= bounds[3],
  );
  const nearby = [...visible]
    .sort((a, b) => {
      const c = map.current?.getCenter() || { lng: -79.383, lat: 43.652 };
      return (
        Math.hypot(
          a.geometry.coordinates[0] - c.lng,
          a.geometry.coordinates[1] - c.lat,
        ) -
        Math.hypot(
          b.geometry.coordinates[0] - c.lng,
          b.geometry.coordinates[1] - c.lat,
        )
      );
    })
    .slice(0, list ? 40 : 4);
  return (
    <div className="app">
      <a className="skip" href="#panel">
        Skip map to accessible controls
      </a>
      <aside className="rail">
        <a
          href="#"
          className="brand"
          aria-label="Luma home"
          onClick={(e) => {
            e.preventDefault();
            setView("explore");
            setSelected(null);
          }}
        >
          <img src="/brand/luma-symbol.png" alt="" />
          <span>
            Luma<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="rail-nav">
          {(
            [
              { id: "explore", icon: Compass, label: "Explore" },
              { id: "routes", icon: RouteIcon, label: "Routes" },
              { id: "settings", icon: SlidersHorizontal, label: "Settings" },
            ] as const
          ).map((n) => (
            <button
              key={n.id}
              onClick={() => {
                setView(n.id);
                setSelected(null);
              }}
              className={view === n.id ? "active" : ""}
              aria-current={view === n.id ? "page" : undefined}
            >
              <n.icon size={22} />
              <span>{n.label}</span>
            </button>
          ))}
        </div>
      </aside>
      <main className="workspace">
        <section
          className="map-shell"
          data-ready={mapReady}
          aria-label="Toronto accessibility map"
        >
          <div ref={container} className="map" />
          {mapError && (
            <div className="map-warning">
              Some map tiles could not load. Location lists remain available.
            </div>
          )}
        </section>
        <section
          className="panel"
          id="panel"
          tabIndex={-1}
          aria-label={
            view === "explore"
              ? "Explore accessibility"
              : view === "routes"
                ? "Plan your route"
                : "Preferences"
          }
        >
          <div className="mobile-handle" />
          {view === "explore" && !selected && (
            <>
              <h1>Luma</h1>
              <div className="search-box">
                <Search size={21} />
                <input
                  aria-label="Search a destination or intersection"
                  placeholder="Where would you like to go?"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    className="icon-button"
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              {query ? (
                <div className="search-results" aria-label="Search results">
                  {searching ? (
                    <p>Searching places…</p>
                  ) : results.length ? (
                    results.map((r) => (
                      <button key={r.id} onClick={() => plan(r)}>
                        <MapPin size={19} />
                        <span>
                          <strong>{r.name}</strong>
                          <small>{r.subtitle}</small>
                        </span>
                        <ArrowUpRight size={18} />
                      </button>
                    ))
                  ) : (
                    <p>No matching places. Try “Union” or “Queen”.</p>
                  )}
                </div>
              ) : (
                <>
                  <div className="quick-actions">
                    <button onClick={locate}>
                      <LocateFixed size={16} />
                      Use my location
                    </button>
                    <button onClick={() => plan()}>
                      <Footprints size={16} />
                      Try a walk
                    </button>
                  </div>
                  <div className="section-heading">
                    <h2>Map features</h2>
                    <Layers size={17} />
                  </div>
                  <p className="muted small">
                    Choose the features you want to see.
                  </p>
                  <div className="filters">
                    {kinds.map((k) => (
                      <button
                        key={k.id}
                        className={
                          "filter " + (active.includes(k.id) ? "on" : "")
                        }
                        aria-pressed={active.includes(k.id)}
                        onClick={() =>
                          setActive((a) =>
                            a.includes(k.id)
                              ? a.filter((x) => x !== k.id)
                              : [...a, k.id],
                          )
                        }
                      >
                        <k.icon size={17} />
                        {k.name}
                        {active.includes(k.id) && <Check size={13} />}
                      </button>
                    ))}
                  </div>
                  <div className="discovery-card">
                    <div className="discovery-icon">
                      <Footprints size={24} />
                    </div>
                    <div>
                      <strong>Walking routes</strong>
                      <p>Find a route that favours audible signals.</p>
                      <button onClick={() => plan()}>
                        Plan a walk <ArrowRight size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="section-heading">
                    <h2>
                      {list
                        ? "Locations in this area"
                        : "Nearby locations"}
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => setList(!list)}
                    >
                      {list ? "Show less" : "View list"}{" "}
                      <ChevronRight size={14} />
                    </button>
                  </div>
                  <div className="nearby">
                    {!loaded ? (
                      <p className="muted">Loading Toronto locations…</p>
                    ) : nearby.length ? (
                      nearby.map((f) => {
                        const k = kinds.find(
                          (k) => k.id === f.properties.kind,
                        )!;
                        return (
                          <button
                            className="place-row"
                            key={f.properties.id}
                            onClick={() => {
                              setSelected(f);
                              map.current?.easeTo({
                                center: f.geometry.coordinates,
                                zoom: 17,
                              });
                            }}
                          >
                            <span className={"place-icon " + k.id}>
                              <k.icon size={19} />
                            </span>
                            <span>
                              <strong>{f.properties.name}</strong>
                              <small>{k.short}</small>
                            </span>
                            <ChevronRight size={17} />
                          </button>
                        );
                      })
                    ) : (
                      <p className="muted">
                        No matching features in this view. Zoom out or enable
                        another filter.
                      </p>
                    )}
                  </div>
                  <div className="data-foot">
                    <span className="online-dot" />
                    {data.length.toLocaleString()} mapped locations · Real
                    Toronto data
                  </div>
                </>
              )}
            </>
          )}
          {selected && view === "explore" && (
            <>
              <button className="back-button" onClick={() => setSelected(null)}>
                <ArrowLeft size={17} />
                Back to explore
              </button>
              <div className={"detail-icon " + selected.properties.kind}>
                {React.createElement(
                  kinds.find((k) => k.id === selected.properties.kind)!.icon,
                  { size: 30 },
                )}
              </div>
              <div className="eyebrow">
                {kinds.find((k) => k.id === selected.properties.kind)?.short}
              </div>
              <h1 className="detail-title">{selected.properties.name}</h1>
              <p className="intro">{selected.properties.purpose}</p>
              <div className="detail-info">
                <h2>What you’ll find</h2>
                <p>{selected.properties.feature.replaceAll(";", " ·")}</p>
                <h2>Location</h2>
                <p>
                  {selected.properties.address_or_position ||
                    `${selected.geometry.coordinates[1].toFixed(5)}, ${selected.geometry.coordinates[0].toFixed(5)}`}
                </p>
                <small>{selected.properties.location_precision}</small>
                {selected.properties.transit_routes && (
                  <>
                    <h2>Transit connections</h2>
                    <p className="small">
                      {selected.properties.transit_routes}
                    </p>
                  </>
                )}
              </div>
              <button
                className="primary"
                onClick={() =>
                  plan({
                    id: selected.properties.id,
                    name: selected.properties.name,
                    subtitle: selected.properties.purpose,
                    coordinates: selected.geometry.coordinates,
                  })
                }
              >
                <Navigation size={18} />
                Walk here <ArrowRight size={17} />
              </button>
              <a
                className="source-link"
                href={selected.properties.source_url}
                target="_blank"
                rel="noreferrer"
              >
                View data source <ExternalLink size={14} />
              </a>
              <p className="muted small">
                {selected.properties.source_status}. Exact entrance or feature
                position may differ from the mapped point.
              </p>
            </>
          )}
          {view === "routes" && (
            <>
              <h1>Walking routes</h1>
              <div className="journey">
                <label htmlFor="start">From</label>
                <div className="journey-field">
                  <span className="journey-point" />
                  <select
                    id="start"
                    value={start.id}
                    onChange={() => setStart(initialStart)}
                  >
                    <option value="union">Union Station</option>
                    {start.id !== "union" && (
                      <option value={start.id}>{start.name}</option>
                    )}
                  </select>
                  <button
                    className="icon-button"
                    aria-label="Use current location for start"
                    onClick={locate}
                  >
                    <LocateFixed size={17} />
                  </button>
                </div>
                <label htmlFor="destination">To</label>
                <div className="journey-field">
                  <MapPin size={17} />
                  <input
                    id="destination"
                    value={end.name}
                    onChange={(e) => {
                      setEnd({ ...end, name: e.target.value });
                      setQuery(e.target.value);
                    }}
                  />
                </div>
                {query && results.length > 0 && (
                  <div className="destination-results">
                    {results.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => {
                          setEnd(r);
                          setQuery("");
                        }}
                      >
                        {r.name}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  className="swap text-button"
                  onClick={() => {
                    const a = start;
                    setStart(end);
                    setEnd(a);
                  }}
                >
                  Swap start and destination
                </button>
              </div>
              <div className="route-prefs">
                <label>
                  <input
                    type="checkbox"
                    checked={audible}
                    onChange={(e) => setAudible(e.target.checked)}
                  />
                  Prefer audible crossings
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={fewer}
                    onChange={(e) => setFewer(e.target.checked)}
                  />
                  Prefer fewer crossings
                </label>
              </div>
              <button
                className="primary"
                disabled={busy || !end.name || !!query}
                onClick={() => plan()}
              >
                {busy ? "Finding your walk…" : "Find walking routes"}
                <ArrowRight size={18} />
              </button>
              {routes.length > 0 && (
                <>
                  <div className="section-heading">
                    <h2>Your options</h2>
                    <span className="muted small">
                      {routes.length} route{routes.length > 1 ? "s" : ""}
                    </span>
                  </div>
                  {routes.map((r, i) => (
                    <button
                      key={r.id}
                      className={
                        "route-card " + (routeIndex === i ? "chosen" : "")
                      }
                      aria-pressed={routeIndex === i}
                      onClick={() => {
                        setRouteIndex(i);
                        setSim(false);
                        setPlaying(false);
                      }}
                    >
                      <div>
                        <span className="route-tag">
                          {i === 0 ? "✦ FOR YOUR WALK" : "SHORTEST WALK"}
                        </span>
                        {routeIndex === i && (
                          <span className="chosen-check">
                            <Check size={14} />
                          </span>
                        )}
                      </div>
                      <strong>
                        {r.minutes}
                        <small> min</small>
                        <span>{(r.distance / 1000).toFixed(2)} km</span>
                      </strong>
                      <p>
                        {r.crossings} crossing{r.crossings !== 1 ? "s" : ""} ·{" "}
                        {r.audible} with listed audible signals
                      </p>
                      <small>
                        {i === 0
                          ? "Based on your crossing preferences"
                          : "A shorter-distance alternative"}
                      </small>
                    </button>
                  ))}
                  {routes.length === 1 && (
                    <p className="muted small">
                      The shortest walk also matches your preferences.
                    </p>
                  )}
                  <div className="route-actions">
                    <button
                      className="secondary"
                      onClick={() =>
                        speak(
                          `${route.minutes} minutes, ${route.crossings} crossings. Audible signals listed at ${route.audible}.`,
                        )
                      }
                    >
                      <Volume2 size={17} />
                      Read summary
                    </button>
                    <button
                      className="primary"
                      onClick={() => {
                        setStep(0);
                        setSim(true);
                        setPlaying(true);
                      }}
                    >
                      <Play size={17} />
                      Preview walk
                    </button>
                  </div>
                  {route.snap_distances.some((n) => n > 20) && (
                    <p className="muted small">
                      Start / arrival points connect to the network{" "}
                      {route.snap_distances.join(" / ")} metres from the
                      selected coordinates.
                    </p>
                  )}
                  <p className="demo-note">
                    Demo routes cover downtown Toronto. Listed audible signals
                    are assumed to cover every crossing direction.
                  </p>
                </>
              )}
              {!routes.length && !busy && (
                <div className="empty-route">
                  <RouteIcon size={32} />
                  <h2>Choose a destination</h2>
                  <p>
                    Try Union Station to Nathan Phillips Square, or select a
                    destination from Explore.
                  </p>
                </div>
              )}
            </>
          )}
          {view === "settings" && (
            <>
              <h1>Settings</h1>
              <h2 className="setting-heading">Colour theme</h2>
              <div className="themes">
                {[
                  {
                    id: "default",
                    name: "Luma",
                    colors: ["#5865F2", "#FF8A4C", "#2CCBA8"],
                  },
                  {
                    id: "red-green",
                    name: "Red–green friendly",
                    colors: ["#0072B2", "#E69F00", "#17212F"],
                  },
                  {
                    id: "blue-yellow",
                    name: "Blue–yellow friendly",
                    colors: ["#9B3658", "#254653", "#F0F0EB"],
                  },
                  {
                    id: "contrast",
                    name: "High contrast",
                    colors: ["#000", "#FFF", "#FFD600"],
                  },
                ].map((t) => (
                  <button
                    className={theme === t.id ? "chosen" : ""}
                    key={t.id}
                    aria-pressed={theme === t.id}
                    onClick={() => setTheme(t.id)}
                  >
                    <span className="swatches">
                      {t.colors.map((c) => (
                        <i key={c} style={{ background: c }} />
                      ))}
                    </span>
                    {t.name}
                    {theme === t.id && <Check size={16} />}
                  </button>
                ))}
              </div>
              <label className="setting-toggle">
                <span>
                  <strong>Larger text</strong>
                  <small>More room for every word</small>
                </span>
                <input
                  type="checkbox"
                  checked={large}
                  onChange={(e) => setLarge(e.target.checked)}
                />
              </label>
              <h2 className="setting-heading">Spoken directions</h2>
              <label className="range-label" htmlFor="speech-rate">
                Speech speed <strong>{rate.toFixed(1)}×</strong>
              </label>
              <input
                id="speech-rate"
                className="range"
                type="range"
                min="0.6"
                max="2"
                step="0.1"
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
              />
              <label className="setting-toggle">
                <span>
                  <strong>Screen reader announcements</strong>
                  <small>Use announcements instead of the app voice</small>
                </span>
                <input
                  type="checkbox"
                  checked={screenReader}
                  onChange={(e) => {
                    setScreenReader(e.target.checked);
                    window.speechSynthesis?.cancel();
                  }}
                />
              </label>
              <button
                className="secondary full"
                onClick={() =>
                  speak(
                    "This is a sample Luma instruction. Your next crossing is ahead.",
                  )
                }
              >
                <Volume2 size={18} />
                Test your voice settings
              </button>
              <div className="about-card">
                <img src="/brand/luma-symbol.png" alt="" />
                <h2>About Luma</h2>
                <p className="small">
                  A hackathon route-planning prototype. Location data: City of
                  Toronto, OpenStreetMap contributors / EmbedEarth (ODbL), TTC
                  and cited providers.
                </p>
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenStreetMap attribution <ExternalLink size={13} />
                </a>
              </div>
            </>
          )}
          <footer className="map-source-credit" aria-label="Map attribution">
            Map: <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> · © <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>
          </footer>
          {error && (
            <div className="error" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={17} />
              </button>
            </div>
          )}
        </section>
        {sim && route && (
          <section className="simulation" aria-label="Simulated walk">
            <div className="sim-top">
              <span>
                <span className="online-dot" />
                SIMULATED WALK · {step + 1} OF {route.steps.length}
              </span>
              <button
                className="icon-button"
                aria-label="Close simulated walk"
                onClick={() => {
                  setSim(false);
                  setPlaying(false);
                  window.speechSynthesis?.cancel();
                }}
              >
                <X size={19} />
              </button>
            </div>
            <div className="sim-instruction">
              <span className="direction-icon">
                {route.steps[step].crossing ? (
                  <Footprints size={28} />
                ) : (
                  <Navigation size={28} />
                )}
              </span>
              <div>
                <small>{route.steps[step].distance} m along the path</small>
                <h2>{route.steps[step].text}</h2>
              </div>
            </div>
            <div className="sim-controls">
              <button onClick={() => speak(route.steps[step].text)}>
                <RotateCcw size={18} />
                Repeat
              </button>
              <button
                onClick={() => {
                  setPlaying(!playing);
                  if (playing) window.speechSynthesis?.cancel();
                }}
              >
                {playing ? <Pause size={18} /> : <Play size={18} />}{" "}
                {playing ? "Pause" : "Resume"}
              </button>
              <button
                disabled={step === route.steps.length - 1}
                onClick={() => setStep((s) => s + 1)}
              >
                Next <ArrowRight size={18} />
              </button>
            </div>
          </section>
        )}
      </main>
      <div className="announcer" role="status" aria-live="polite">
        {screenReader ? notice : ""}
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
