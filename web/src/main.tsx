import React, { useEffect, useRef, useState } from "react";
import PlacePicker from "./PlacePicker";
import { createRoot } from "react-dom/client";
import * as maplibregl from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import {
  Search,
  Mic,
  Keyboard,
  Bookmark,
  Eye,
  Info,
  Minus,
  Plus,
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
import "./focused.css";
import "./routing.css";
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
    title: string;
    kind: string;
    scheduled_time?: string;
    coordinates: Coord;
    distance: number;
    crossing: boolean;
  }[];
  snap_distances: number[];
  mode: 'walk'|'bus';
  departure_time: string;
  arrival_time: string;
  duration_seconds: number;
  timing: 'estimated'|'scheduled';
  explanation: string;
  tactile: number;
  walking_minutes?: number;
  riding_minutes?: number;
  waiting_minutes?: number;
  transfers?: number;
  segments: {mode:'walk'|'bus'|'connect';coordinates:Coord[];route?:string}[];
  bus_legs?: {route:string;headsign:string;from_name:string;to_name:string;departure_time:string;arrival_time:string;stops:number}[];
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
    [audible, setAudible] = useState(() => saved("audible-v2", false)),
    [fewer, setFewer] = useState(() => saved("fewer-v2", false)),
    [rate, setRate] = useState(() => saved("rate", 1)),
    [screenReader, setScreenReader] = useState(() =>
      saved("screenReader", false),
    ),
    [large, setLarge] = useState(() => saved("large", false));
  const [tactile,setTactile]=useState(()=>saved('tactile-v2',false));
  const [walkingSpeed,setWalkingSpeed]=useState(()=>saved('walking-speed',1.2));
  const [travelMode,setTravelMode]=useState<'walk'|'bus'>('walk');
  const [startValid,setStartValid]=useState(true),[endValid,setEndValid]=useState(true);
  const [departureTime,setDepartureTime]=useState('');
  const [timetable,setTimetable]=useState<{service_start:string;service_end:string}|null>(null);
  useEffect(()=>{request<{service_start:string;service_end:string}>('/api/transit/meta').then(setTimetable).catch(()=>{});},[]);
  function feedDate(value:string){return value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6,8);}
  const [pickMode,setPickMode]=useState<'start'|'end'|null>(null);
  const pickModeRef=useRef(pickMode);pickModeRef.current=pickMode;
  const requestNumber=useRef(0),lastPlanned=useRef('');
  const planningKey=JSON.stringify([start.coordinates,end.coordinates,audible,fewer,tactile,walkingSpeed,travelMode,departureTime]);
  const currentPlanningKey=useRef(planningKey);currentPlanningKey.current=planningKey;
  useEffect(()=>{localStorage.setItem('luma-audible-v2',JSON.stringify(audible));localStorage.setItem('luma-fewer-v2',JSON.stringify(fewer));localStorage.setItem('luma-tactile-v2',JSON.stringify(tactile));localStorage.setItem('luma-walking-speed',JSON.stringify(walkingSpeed));},[audible,fewer,tactile,walkingSpeed]);
  useEffect(()=>{
    if(!startValid||!endValid){requestNumber.current++;setRoutes([]);setBusy(false);return;}
    if(lastPlanned.current && lastPlanned.current!==planningKey && view==='routes'){
      const timer=setTimeout(()=>plan(),350);return()=>clearTimeout(timer);
    }
  },[planningKey,view,startValid,endValid]);
  function timeLabel(time:string){return new Date(time).toLocaleTimeString('en-CA',{hour:'numeric',minute:'2-digit',timeZone:'America/Toronto'});}
  const [sim, setSim] = useState(false),
    [playing, setPlaying] = useState(false),
    [step, setStep] = useState(0);
  const [settingsSection, setSettingsSection] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [listening, setListening] = useState(false);
  const [typing, setTyping] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  useEffect(()=>{const panel=document.getElementById('panel');if(panel)panel.scrollTop=0;},[view,settingsSection,selected]);
  const selectedRef = useRef(setSelected);
  selectedRef.current = (f)=>{if(!pickModeRef.current){setSelected(f);setView("explore");}};
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
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 13,
        },
        paint: { "text-color": "#ffffff" },
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
        filter: ['!=',['get','mode'],'connect'],
        paint: { "line-color": ['match',['get','mode'],'bus','#b04d16','#5865F2'], "line-width": 5 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      m.addLayer({id:'route-connect',type:'line',source:'route',filter:['==',['get','mode'],'connect'],paint:{'line-color':'#5865F2','line-width':4,'line-dasharray':[1,2]}});
      m.on('click', e=>{
        const target=pickModeRef.current;if(!target)return;
        const place:Place={id:'pin-'+Date.now(),name:target==='start'?'Pinned start':'Pinned destination',subtitle:`${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`,coordinates:[e.lngLat.lng,e.lngLat.lat]};
        if(target==='start'){setStart(place);setStartValid(true);}else{setEnd(place);setEndValid(true);}setPickMode(null);setNotice('Map location selected.');
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
        container.current?.setAttribute('data-visible-route-segments',String(m.queryRenderedFeatures({layers:['route-line']}).length));
        container.current?.setAttribute(
          "data-visible-points",
          String(
            m.queryRenderedFeatures({ layers: ["points", "clusters"] }).length,
          ),
        );
      });
      setMapReady(true);
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
      features: route ? route.segments.filter(s=>s.coordinates.length>1).map(s=>({type:'Feature' as const,properties:{mode:s.mode},geometry:{type:'LineString' as const,coordinates:s.coordinates}})) : [],
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
      m.fitBounds(b, { padding: window.innerWidth>760 ? {top:70,bottom:70,left:450,right:60} : {top:50,bottom:window.innerHeight*.6,left:30,right:30}, maxZoom: 16 });
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
        setStartValid(true);
        map.current?.flyTo({ center: c, zoom: 16 });
        speak(
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
    if(!startValid||(!destination&&!endValid)){setError('Select a suggested place or choose a point on the map for both locations.');return;}
    const number=++requestNumber.current;
    const key=JSON.stringify([start.coordinates,target.coordinates,audible,fewer,tactile,walkingSpeed,travelMode,departureTime]);
    lastPlanned.current=key;
    setEnd(target);setEndValid(true);setPickMode(null);
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
            start_name:start.name,end_name:target.name,
            prefer_audible: audible,
            fewer_crossings: fewer,
            prefer_tactile:tactile,walking_speed:walkingSpeed,
            mode:travelMode,
            departure_time:departureTime||null,
          }),
        },
      );
      if(number!==requestNumber.current||key!==currentPlanningKey.current)return;
      setRoutes(d.routes);
      setRouteIndex(0);setStep(0);
      setNotice(
        `${d.routes.length} route option${d.routes.length === 1 ? "" : "s"} found.`,
      );
    } catch (e) {
      if(number===requestNumber.current)setError((e as Error).message);
    } finally {
      if(number===requestNumber.current)setBusy(false);
    }
  }
  function voiceSearch() {
    type Recognition = {
      lang: string;
      interimResults: boolean;
      onresult:
        ((event: { results: { transcript: string }[][] }) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    };
    const api = window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const Constructor = api.SpeechRecognition || api.webkitSpeechRecognition;
    if (!Constructor) {
      setTyping(true);
      setError(
        "Voice search is unavailable in this browser. Type your destination below.",
      );
      searchInput.current?.focus();
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    window.speechSynthesis?.cancel();
    const recognition = new Constructor();
    recognitionRef.current = recognition;
    recognition.lang = "en-CA";
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      setTyping(true);
      setQuery(event.results[0][0].transcript);
      searchInput.current?.focus();
    };
    recognition.onerror = () => {
      setError("Could not hear a destination. Try again or type it below.");
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    try {
      recognition.start();
      setListening(true);
    } catch {
      setError("Microphone access is unavailable. Please type a destination.");
    }
  }
  useEffect(() => () => recognitionRef.current?.stop(), []);
  useEffect(() => {
    if (sim) document.getElementById("navigation-title")?.focus();
  }, [sim]);
  function endPreview() {
    setSim(false);
    setPlaying(false);
    window.speechSynthesis?.cancel();
    setTimeout(() => document.getElementById("preview-walk")?.focus(), 0);
  }
  function simulatedLocation() {
    if (!route) return;
    const c = route.steps[step].coordinates;
    const signals = data.filter((f) => f.properties.kind === "signal");
    const closest = signals.sort(
      (a, b) =>
        Math.hypot(
          a.geometry.coordinates[0] - c[0],
          a.geometry.coordinates[1] - c[1],
        ) -
        Math.hypot(
          b.geometry.coordinates[0] - c[0],
          b.geometry.coordinates[1] - c[1],
        ),
    )[0];
    speak(
      closest
        ? `Simulated position near ${closest.properties.name}. This is the route preview, not your GPS location.`
        : "This is a simulated route position.",
    );
  }
  return (
    <div className={"app" + (sim ? " navigating" : "")}>
      <a className="skip" href="#panel">
        Skip map to accessible controls
      </a>
      <aside className="rail" hidden={sim}>
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
                setSettingsSection(null);
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
          inert={sim}
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
          className={"panel" + (view === "settings" ? " settings-panel" : "")}
          hidden={sim}
          id="panel"
          data-loaded={loaded}
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
              <h1 className="announcer">Luma</h1>
              <button
                className="voice-destination"
                aria-pressed={listening}
                onClick={voiceSearch}
              >
                <Mic size={32} />
                {listening ? "Listening… tap to stop" : "Say where to go"}
              </button>
              <div className="home-actions">
                <button onClick={() => {setTyping(true);setTimeout(()=>searchInput.current?.focus(),0);}}>
                  <Keyboard size={24} />
                  Type
                </button>
                <button onClick={() => plan(initialEnd)}>
                  <Bookmark size={24} />
                  Nathan Phillips Square
                </button>
              </div>
              <div className="search-box" hidden={!typing && !query}>
                <Search size={21} />
                <input
                  ref={searchInput}
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
                      Where am I?
                    </button>
                    <button onClick={() => plan()}>
                      <Footprints size={16} />
                      Try a walk
                    </button>
                  </div>
                  <details className="simple-details">
                    <summary>
                      <Layers size={21} />
                      Map features
                    </summary>{" "}
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
                  </details>
                  <button
                    className="secondary full example-walk"
                    onClick={() => plan()}
                  >
                    <Footprints size={20} />
                    Try a walk
                    <ArrowRight size={18} />
                  </button>


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
              <h1>Plan a journey</h1>
              <div className="journey-fields">
                <PlacePicker label="From" value={start} onChange={p=>{setStart(p);setStartValid(true);}} onValidityChange={setStartValid}/>
                <div className="endpoint-tools"><button onClick={locate}><LocateFixed size={16}/>Use my location</button><button aria-pressed={pickMode==='start'} onClick={()=>setPickMode(p=>p==='start'?null:'start')}><MapPin size={16}/>Choose start on map</button></div>
                <PlacePicker label="To" value={end} onChange={p=>{setEnd(p);setEndValid(true);}} onValidityChange={setEndValid}/>
                <div className="endpoint-tools"><button onClick={()=>{setStart(end);setEnd(start);setStartValid(true);setEndValid(true);}}>Swap start and destination</button><button aria-pressed={pickMode==='end'} onClick={()=>setPickMode(p=>p==='end'?null:'end')}><MapPin size={16}/>Choose end on map</button></div>
              </div>
              {pickMode&&<div className="pick-notice" role="status">Tap the map to choose your {pickMode==='start'?'start':'destination'}.<button onClick={()=>setPickMode(null)}>Cancel</button></div>}
              <div className="travel-modes" role="group" aria-label="Travel mode"><button aria-pressed={travelMode==='walk'} onClick={()=>setTravelMode('walk')}><Footprints size={20}/>Walk</button><button aria-pressed={travelMode==='bus'} onClick={()=>setTravelMode('bus')}><Bus size={20}/>Bus + walk</button></div>
              {travelMode==='bus'&&<div className="departure-picker"><label htmlFor="departure">Leave at (Toronto time)</label><input id="departure" type="datetime-local" min={timetable?feedDate(timetable.service_start)+'T00:00':undefined} max={timetable?feedDate(timetable.service_end)+'T23:59':undefined} value={departureTime} onChange={e=>setDepartureTime(e.target.value)}/><button className="text-button" onClick={()=>setDepartureTime('')}>{departureTime?'Leave now':'Leaving now'}</button><p>Scheduled TTC times, not live arrivals. {timetable&&<>Timetable: {feedDate(timetable.service_start)} to {feedDate(timetable.service_end)}. </>}Up to one same-stop transfer.</p></div>}
              <p className="routing-summary">{audible||fewer||tactile?'Accessibility preferences are on. Walking paths may take longer.':'Fastest route by default.'}</p>
              <details className="simple-details">
                <summary>
                  <SlidersHorizontal size={20} />
                  Crossing preferences
                </summary>{" "}
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
                  <label><input type="checkbox" checked={tactile} onChange={e=>setTactile(e.target.checked)}/>Prefer mapped tactile paving</label>
                  <label className="walking-speed-label">Walking speed<select aria-label="Walking speed" value={walkingSpeed} onChange={e=>setWalkingSpeed(Number(e.target.value))}><option value={.8}>Slower · 0.8 m/s</option><option value={1.2}>Standard · 1.2 m/s</option><option value={1.5}>Brisk · 1.5 m/s</option></select></label>
                </div>
              </details>
              <button
                className="primary"
                disabled={busy || !startValid || !endValid}
                onClick={() => plan()}
              >
                {busy ? "Planning your journey…" : "Find routes"}
                <ArrowRight size={18} />
              </button>
              {busy&&<p className="planning-status" role="status">Calculating paths and directions. The first journey can take a little longer while the network loads.</p>}
              {(!startValid||!endValid)&&<p className="planning-status" role="status">Choose a search suggestion or a point on the map to confirm both locations.</p>}
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
                          {r.name}
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
                        <span>{(r.distance / 1000).toFixed(2)} km{r.mode==='bus'?' on foot':''}</span>
                      </strong>
                      <p>
                        {r.crossings} crossing{r.crossings !== 1 ? "s" : ""} ·{" "}
                        {r.audible} with listed audible signals
                      </p>
                      <small>{r.explanation}</small>
                      <div className="arrival-label">{r.timing==='scheduled'?'Scheduled arrival':'Estimated arrival'}: {timeLabel(r.arrival_time)}</div>
                      {r.mode==='bus'&&<><p className="bus-summary"><Bus size={15}/>{r.bus_legs?.map(l=>l.route).join(' → ')} · {r.transfers} transfer{r.transfers===1?'':'s'}</p><p>{r.walking_minutes} min walking · {r.waiting_minutes} min waiting · {r.riding_minutes} min on bus</p></>}
                    </button>
                  ))}
                  {routes.length === 1 && travelMode==='walk' && (audible||fewer||tactile) && (
                    <p className="muted small">
                      The fastest walk already meets this preference balance.
                    </p>
                  )}
                  <div className="route-actions">
                    <button
                      className="secondary"
                      onClick={() =>
                        speak(
                          `${route.minutes} minutes. ${route.mode==='bus'?'Scheduled':'Estimated'} arrival ${timeLabel(route.arrival_time)}. ${route.crossings} walking crossings. Audible signals listed at ${route.audible}. ${route.explanation}`,
                        )
                      }
                    >
                      <Volume2 size={17} />
                      Read summary
                    </button>
                    <button
                      id="preview-walk"
                      className="primary"
                      onClick={() => {
                        setStep(0);
                        setSim(true);
                        setPlaying(true);
                      }}
                    >
                      <Play size={17} />
                      {route.mode==='bus'?'Preview journey':'Preview walk'}
                    </button>
                  </div>
                  {route.snap_distances.some((n) => n > 20) && (
                    <p className="muted small">
                      Start / arrival points connect to the network{" "}
                      {route.snap_distances.join(" / ")} metres from the
                      selected coordinates.
                    </p>
                  )}
                  <details className="itinerary" open><summary>Step-by-step directions · {route.steps.length} steps</summary><ol>{route.steps.map((instruction,i)=><li key={i}><span className={'step-symbol '+instruction.kind}>{['wait','board','ride','alight'].includes(instruction.kind)?<Bus size={18}/>:<Footprints size={18}/>}</span><div><strong>{instruction.title}</strong><p>{instruction.text.startsWith(instruction.title+'. ')?instruction.text.slice(instruction.title.length+2):instruction.text}</p>{instruction.scheduled_time&&<time>{timeLabel(instruction.scheduled_time)} · scheduled</time>}</div></li>)}</ol></details>
                  <p className="demo-note">Accessibility preferences prioritize documented features; they do not guarantee a safer crossing. Listed audible signals are assumed to cover all directions. {route.mode==='bus'?'Bus arrival times follow the downloaded timetable.':'Walking times include an estimated 20 seconds per crossing.'}</p>

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
              {settingsSection && (
                <button
                  className="back-button"
                  onClick={() => setSettingsSection(null)}
                >
                  <ArrowLeft size={20} />
                  All settings
                </button>
              )}
              {!settingsSection && (
                <>
                  <div className="speed-card">
                    <h2>Speech speed</h2>
                    <div>
                      <button
                        aria-label="Decrease speech speed"
                        onClick={() =>
                          setRate((r) =>
                            Math.max(0.6, Math.round((r - 0.1) * 10) / 10),
                          )
                        }
                      >
                        <Minus />
                      </button>
                      <strong>{rate.toFixed(1)}×</strong>
                      <button
                        aria-label="Increase speech speed"
                        onClick={() =>
                          setRate((r) =>
                            Math.min(2, Math.round((r + 0.1) * 10) / 10),
                          )
                        }
                      >
                        <Plus />
                      </button>
                    </div>
                    <button
                      className="secondary full"
                      onClick={() =>
                        speak(
                          "This is a sample Luma instruction. Your next crossing is ahead.",
                        )
                      }
                    >
                      <Volume2 size={22} />
                      Test voice
                    </button>
                  </div>
                  <div className="settings-grid">
                    {[
                      { id: "voice", label: "Voice", icon: Volume2 },
                      { id: "crossings", label: "Crossings", icon: Footprints },
                      { id: "display", label: "Display", icon: Eye },
                      {
                        id: "reader",
                        label: "Screen reader",
                        icon: Headphones,
                      },
                      { id: "about", label: "About & data", icon: Info },
                    ].map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setSettingsSection(item.id)}
                      >
                        <item.icon size={26} />
                        {item.label}
                        <ChevronRight size={18} />
                      </button>
                    ))}
                  </div>
                </>
              )}
              <section
                hidden={settingsSection !== "display"}
                aria-label="Display settings"
              >
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
              </section>
              <section
                hidden={settingsSection !== "voice"}
                aria-label="Voice settings"
              >
                {" "}
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
                <button
                  className="secondary full"
                  onClick={() =>
                    speak(
                      "This is a sample Luma instruction. Your next crossing is ahead.",
                    )
                  }
                >
                  <Volume2 size={22} />
                  Test voice
                </button>
              </section>
              <section
                hidden={settingsSection !== "reader"}
                aria-label="Screen reader settings"
              >
                {" "}
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
              </section>
              <section
                hidden={settingsSection !== "crossings"}
                aria-label="Crossing settings"
              >
                <h2 className="setting-heading">Crossings</h2>
                <label className="setting-toggle">
                  <span>Prefer audible crossings</span>
                  <input
                    type="checkbox"
                    checked={audible}
                    onChange={(e) => setAudible(e.target.checked)}
                  />
                </label>
                <label className="setting-toggle">
                  <span>Prefer fewer crossings</span>
                  <input
                    type="checkbox"
                    checked={fewer}
                    onChange={(e) => setFewer(e.target.checked)}
                  />
                </label>
              </section>
              <section hidden={settingsSection!=='crossings'} aria-label="Additional crossing preferences"><label className="setting-toggle"><span>Prefer mapped tactile paving</span><input type="checkbox" checked={tactile} onChange={e=>setTactile(e.target.checked)}/></label><label className="setting-toggle"><span>Walking speed</span><select aria-label="Settings walking speed" value={walkingSpeed} onChange={e=>setWalkingSpeed(Number(e.target.value))}><option value={.8}>Slower</option><option value={1.2}>Standard</option><option value={1.5}>Brisk</option></select></label></section>
              <section
                hidden={settingsSection !== "about"}
                aria-label="About and data"
              >
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
          <footer className="map-source-credit" aria-label="Map attribution">
            Map:{" "}
            <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">
              OpenFreeMap
            </a>{" "}
            · ©{" "}
            <a
              href="https://openmaptiles.org/"
              target="_blank"
              rel="noreferrer"
            >
              OpenMapTiles
            </a>{" "}
            · ©{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
            >
              OpenStreetMap contributors
            </a>
          </footer>
                </div>
              </section>
            </>
          )}

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
          <section className="journey-mode" aria-label={route.mode==='bus'?'Simulated journey':'Simulated walk'}>
            <header className="journey-mode-header">
              <img src="/brand/luma-symbol.png" alt="" />
              <div>
                <small>{route.mode==='bus'?'Previewing journey to':'Previewing walk to'}</small>
                <strong>{end.name}</strong>
              </div>
              <span className="preview-badge">Simulation</span>
              <button
                className="icon-button"
                aria-label="Close simulated walk"
                onClick={endPreview}
              >
                <X size={22} />
              </button>
            </header>
            <div className="instruction-card">
              <span className="instruction-symbol">
                {['wait','board','ride','alight'].includes(route.steps[step].kind)?<Bus size={36}/>:route.steps[step].crossing?<Footprints size={36}/>:<Navigation size={36}/>}
              </span>
              <p>{route.steps[step].scheduled_time ? timeLabel(route.steps[step].scheduled_time!)+' · scheduled' : route.steps[step].distance>0 ? route.steps[step].distance+' metres' : 'Next instruction'}</p>
                <h2 id="navigation-title" tabIndex={-1}>{route.steps[step].title}</h2>
              <p className="instruction-context">{route.steps[step].text.startsWith(route.steps[step].title+'. ')?route.steps[step].text.slice(route.steps[step].title.length+2):route.steps[step].text}</p>
            </div>
            {route.steps[step + 1] && (
              <div className="next-instruction">
                <strong>Then</strong>
                <p>{route.steps[step + 1].title}</p>
              </div>
            )}
            <div className="journey-progress">
              <span>
                {route.minutes} min journey · arrival {timeLabel(route.arrival_time)}
              </span>
              <span>
                Step {step + 1} of {route.steps.length}
              </span>
            </div>
            <div className="journey-controls">
              <button onClick={() => speak(route.steps[step].text)}>
                <RotateCcw size={26} />
                Repeat
              </button>
              <button
                onClick={() => {
                  setPlaying(!playing);
                  if (playing) window.speechSynthesis?.cancel();
                }}
              >
                {playing ? <Pause size={26} /> : <Play size={26} />}{" "}
                {playing ? "Pause" : "Resume"}
              </button>
              <button className="where-button" onClick={simulatedLocation}>
                <LocateFixed size={26} />
                Where am I?
              </button>
              <button className="end-button" onClick={endPreview}>
                <X size={26} />
                End
              </button>
            </div>
            <button
              className="secondary full next-step"
              disabled={step === route.steps.length - 1}
              onClick={() => {
                setPlaying(false);
                setStep((s) => s + 1);
              }}
            >
              Next instruction <ArrowRight size={22} />
            </button>
            <div className="spoken-strip" aria-hidden="true">
              <Volume2 size={21} />
              <p>
                <strong>Instruction</strong>
                {notice || route.steps[step].text}
              </p>
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
