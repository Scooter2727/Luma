import { useEffect, useRef, useState } from "react";
import {
  Home,
  Route as RouteIcon,
  Flag,
  SlidersHorizontal,
  ArrowLeft,
  ArrowRight,
  Star,
  X,
  Layers,
  ExternalLink,
} from "lucide-react";
import MapView from "./MapView";
import Hero from "./Hero";
import HomeView from "./HomeView";
import { JourneyPlanner, RouteChoices } from "./JourneyPlanner";
import { Onboarding, Settings } from "./Preferences";
import NavigationView from "./NavigationView";
import { logoForTheme } from "./brand";
import ReportView, { ReportHistory } from "./ReportView";
import type { LocatedPlace } from "./ReportView";
import {
  initialStart,
  initialEnd,
  kinds,
  saved,
  request,
  instructionText,
} from "./model";
import type { Coord, Feature, Place, Preferences, Route } from "./model";
import "./app.css";
type View =
  | "home"
  | "routes"
  | "settings"
  | "report"
  | "navigate"
  | "map"
  | "saved";
type Recognition = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: { transcript: string }[][] }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
function getLocation(): Promise<LocatedPlace> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(
        Error(
          "Location is unavailable in this browser. Choose a place instead.",
        ),
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          id: "current",
          name: "Your location",
          subtitle: `GPS accuracy approximately ${Math.round(p.coords.accuracy)} metres`,
          coordinates: [p.coords.longitude, p.coords.latitude],
          locationSource: "gps",
          accuracy: p.coords.accuracy,
        }),
      () =>
        reject(
          Error(
            "Location access is unavailable. Choose a place or a point on the map.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  });
}
export default function App() {
  const [prefs, setPrefs] = useState<Preferences>(() => ({
    audible: saved("audible-v2", false),
    fewer: saved("fewer-v2", false),
    tactile: saved("tactile-v2", false),
    walkingSpeed: saved("walking-speed", 1.2),
    rate: saved("rate", 1),
    screenReader: saved("screenReader", false),
    large: saved("large", false),
    theme: localStorage.getItem("luma-theme") || "default",
    directions: saved("directions-style", "left-right"),
  }));
  const [onboarding, setOnboarding] = useState(
    () => !saved("onboarding-complete", false),
  );
  const [showHero, setShowHero] = useState(true);
  const [view, setView] = useState<View>("home"),
    [data, setData] = useState<Feature[]>([]),
    [loaded, setLoaded] = useState(false),
    [active, setActive] = useState(kinds.map((k) => k.id));
  const [start, setStart] = useState<Place>(initialStart),
    [end, setEnd] = useState<Place>(initialEnd),
    [startValid, setStartValid] = useState(true),
    [endValid, setEndValid] = useState(true);
  const [routes, setRoutes] = useState<Route[]>([]),
    [routeIndex, setRouteIndex] = useState(0),
    [showOptions, setShowOptions] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"walk" | "bus">("walk"),
    [departure, setDeparture] = useState(""),
    [timetable, setTimetable] = useState<{
      service_start: string;
      service_end: string;
    } | null>(null);
  const [listening, setListening] = useState(false),
    recognition = useRef<Recognition | null>(null);
  const [selected, setSelected] = useState<Feature | null>(null),
    [pickMode, setPickMode] = useState<"start" | "end" | null>(null),
    [mapReturn, setMapReturn] = useState<View>("home"),
    [camera, setCamera] = useState<Coord | undefined>();
  const [step, setStep] = useState(0),
    [playing, setPlaying] = useState(false),
    [reportLocation, setReportLocation] = useState<LocatedPlace>(initialStart),
    [reportReturn, setReportReturn] = useState<View>("home");
  const [savedPlaces, setSavedPlaces] = useState<Place[]>(() =>
      saved("saved-places", []),
    ),
    [lastTrip, setLastTrip] = useState<Place | null>(() =>
      saved("last-trip", null),
    );
  const requestNumber = useRef(0),
    lastPlanned = useRef("");
  const keyFor = (target: Place, origin: Place = start) =>
    JSON.stringify([
      origin.coordinates,
      target.coordinates,
      prefs.audible,
      prefs.fewer,
      prefs.tactile,
      prefs.walkingSpeed,
      mode,
      departure,
    ]);
  const planningKey = keyFor(end),
    currentKey = useRef(planningKey);
  currentKey.current = planningKey;
  const route = routes[routeIndex],
    currentStep = route?.steps[step];
  const change = (values: Partial<Preferences>) =>
    setPrefs((p) => ({ ...p, ...values }));
  function speak(text: string) {
    setNotice(text);
    if (!prefs.screenReader && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = prefs.rate;
      window.speechSynthesis.speak(u);
    }
  }
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
    document.documentElement.classList.toggle("large-text", prefs.large);
    localStorage.setItem("luma-theme", prefs.theme);
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (favicon) {
      favicon.type = "image/svg+xml";
      favicon.href = logoForTheme(prefs.theme);
    }
    for (const [key, value] of Object.entries({
      "audible-v2": prefs.audible,
      "fewer-v2": prefs.fewer,
      "tactile-v2": prefs.tactile,
      "walking-speed": prefs.walkingSpeed,
      rate: prefs.rate,
      screenReader: prefs.screenReader,
      large: prefs.large,
      "directions-style": prefs.directions,
    }))
      localStorage.setItem("luma-" + key, JSON.stringify(value));
    if (prefs.screenReader) window.speechSynthesis?.cancel();
  }, [prefs]);
  useEffect(() => {
    const c = new AbortController();
    request<{ features: Feature[] }>("/api/locations", { signal: c.signal })
      .then((d) => {
        setData(d.features);
        setLoaded(true);
      })
      .catch(() => {
        if (!c.signal.aborted) {
          setError(
            "Location data could not load. Check that the local API is running.",
          );
          setLoaded(true);
        }
      });
    request<{ service_start: string; service_end: string }>(
      "/api/transit/meta",
      { signal: c.signal },
    )
      .then(setTimetable)
      .catch(() => {});
    return () => c.abort();
  }, []);
  useEffect(() => {
    localStorage.setItem("luma-saved-places", JSON.stringify(savedPlaces));
  }, [savedPlaces]);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      document.getElementById("panel")?.scrollTo({ top: 0 });
      document.querySelector<HTMLElement>("#panel h1")?.focus();
    });
    recognition.current?.stop();
    return () => cancelAnimationFrame(id);
  }, [view, showOptions]);
  useEffect(() => {
    if (!startValid || !endValid) {
      requestNumber.current++;
      setRoutes([]);
      setBusy(false);
      return;
    }
    if (
      lastPlanned.current &&
      lastPlanned.current !== planningKey &&
      view === "routes" &&
      showOptions
    ) {
      const t = setTimeout(() => void plan(), 350);
      return () => clearTimeout(t);
    }
  }, [planningKey, view, showOptions, startValid, endValid]);
  useEffect(() => {
    if (view !== "navigate" || !route || !currentStep) return;
    speak(
      instructionText(currentStep, route.steps[step - 1], prefs.directions),
    );
    if (currentStep.crossing) setPlaying(false);
  }, [view, step]);
  useEffect(() => {
    if (!playing || view !== "navigate" || !route) return;
    const t = setTimeout(
      () => {
        if (step < route.steps.length - 1) setStep((s) => s + 1);
        else setPlaying(false);
      },
      Math.max(6500, ((currentStep?.text.length || 100) * 70) / prefs.rate),
    );
    return () => clearTimeout(t);
  }, [playing, view, step, route, prefs.rate]);
  useEffect(
    () => () => {
      recognition.current?.stop();
      window.speechSynthesis?.cancel();
    },
    [],
  );
  function dictate(callback: (text: string) => void) {
    const b = window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const C = b.SpeechRecognition || b.webkitSpeechRecognition;
    if (!C) return false;
    if (listening) {
      recognition.current?.stop();
      return true;
    }
    const r = new C();
    recognition.current = r;
    r.lang = "en-CA";
    r.interimResults = false;
    r.onresult = (e) => callback(e.results[0][0].transcript);
    r.onerror = () => {
      setListening(false);
      setError("Voice input could not be heard. You can type instead.");
    };
    r.onend = () => setListening(false);
    try {
      window.speechSynthesis?.cancel();
      r.start();
      setListening(true);
      return true;
    } catch {
      return false;
    }
  }
  async function locateStart() {
    try {
      const p = await getLocation();
      setStart(p);
      setStartValid(true);
      setCamera(p.coordinates);
      speak("Location found. " + p.subtitle);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function whereAmI() {
    if (view === "navigate" && currentStep) {
      const nearest = data
        .filter((f) => f.properties.kind === "signal")
        .sort(
          (a, b) =>
            Math.hypot(
              a.geometry.coordinates[0] - currentStep.coordinates[0],
              a.geometry.coordinates[1] - currentStep.coordinates[1],
            ) -
            Math.hypot(
              b.geometry.coordinates[0] - currentStep.coordinates[0],
              b.geometry.coordinates[1] - currentStep.coordinates[1],
            ),
        )[0];
      speak(
        "Simulated position " +
          (nearest
            ? "near " + nearest.properties.name
            : "on the selected route") +
          ". This is the route preview, not your GPS location.",
      );
      return;
    }
    await locateStart();
  }
  function go(next: View) {
    setError("");
    setSelected(null);
    setPickMode(null);
    setView(next);
    if (next === "report") {
      setReportLocation({ ...start, locationSource: "selected" });
      setReportReturn("home");
    }
    if (next === "routes" && !routes.length) setShowOptions(false);
  }
  function showMap(returnTo: View) {
    setMapReturn(returnTo);
    setView("map");
  }
  function openReport() {
    if (currentStep) {
      setReportLocation({
        id: "preview-" + step,
        name: currentStep.title.includes(" at ")
          ? currentStep.title.split(" at ").slice(1).join(" at ")
          : currentStep.street || currentStep.title,
        subtitle: "Approximate route-preview position",
        coordinates: currentStep.coordinates,
        locationSource: "route_preview",
      });
      setReportReturn("navigate");
    } else {
      setReportLocation({ ...start, locationSource: "selected" });
      setReportReturn("home");
    }
    setPlaying(false);
    setView("report");
  }
  function cancelPlanning() {
    requestNumber.current++;
    setBusy(false);
    setShowOptions(false);
    setError("");
  }
  async function plan(destination?: Place, origin: Place = start) {
    const target = destination || end;
    if (!startValid || (!destination && !endValid)) {
      setError("Choose a search suggestion or map point for both locations.");
      return;
    }
    const number = ++requestNumber.current,
      key = keyFor(target, origin);
    lastPlanned.current = key;
    setEnd(target);
    setEndValid(true);
    setView("routes");
    setShowOptions(true);
    setSelected(null);
    setPickMode(null);
    setPlaying(false);
    setBusy(true);
    setError("");
    setRoutes([]);
    try {
      const d = await request<{ routes: Route[] }>("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: origin.coordinates,
          end: target.coordinates,
          start_name: origin.name,
          end_name: target.name,
          prefer_audible: prefs.audible,
          fewer_crossings: prefs.fewer,
          prefer_tactile: prefs.tactile,
          walking_speed: prefs.walkingSpeed,
          mode,
          departure_time: departure || null,
        }),
      });
      if (number !== requestNumber.current || key !== currentKey.current)
        return;
      setRoutes(d.routes);
      setRouteIndex(0);
      setStep(0);
      setNotice(d.routes.length + " route options found.");
    } catch (e) {
      if (number === requestNumber.current) setError((e as Error).message);
    } finally {
      if (number === requestNumber.current) setBusy(false);
    }
  }
  function startPreview() {
    setStep(0);
    setPlaying(true);
    setLastTrip(end);
    localStorage.setItem("luma-last-trip", JSON.stringify(end));
    setView("navigate");
  }
  function endPreview() {
    setPlaying(false);
    window.speechSynthesis?.cancel();
    setView("routes");
    setTimeout(() => document.getElementById("preview-route")?.focus(), 0);
  }
  function completeSetup() {
    localStorage.setItem("luma-onboarding-complete", "true");
    setOnboarding(false);
    setView("home");
  }
  const prefProps = { prefs, change, speak };
  const selectedPlace = selected
    ? {
        id: selected.properties.id,
        name: selected.properties.name,
        subtitle: selected.properties.address_or_position,
        coordinates: selected.geometry.coordinates,
      }
    : null;
  if (onboarding)
    return (
      <>
        {showHero && (
          <Hero theme={prefs.theme} onEnter={() => setShowHero(false)} />
        )}
        <div className="setup-shell">
          <Onboarding {...prefProps} done={completeSetup} />
          <div className="sr-only" role="status">
            {notice}
          </div>
        </div>
      </>
    );
  return (
    <>
      {showHero && (
        <Hero theme={prefs.theme} onEnter={() => setShowHero(false)} />
      )}
      <div className={"app " + (view === "navigate" ? "navigating" : "")}>
      <a className="skip" href="#panel">
        Skip map to controls
      </a>
      <nav
        className="main-nav"
        aria-label="Main"
        hidden={view === "navigate" || (view === "routes" && showOptions)}
      >
        <a
          className="brand"
          href="#"
          aria-label="Luma home"
          onClick={(e) => {
            e.preventDefault();
            go("home");
          }}
        >
          <img src={logoForTheme(prefs.theme)} alt="" />
          <span>Luma</span>
        </a>
        {(
          [
            { id: "home", label: "Home", icon: Home },
            { id: "routes", label: "Routes", icon: RouteIcon },
            { id: "report", label: "Report", icon: Flag },
            { id: "settings", label: "Settings", icon: SlidersHorizontal },
          ] as const
        ).map((n) => (
          <button
            key={n.id}
            className={view === n.id ? "active" : ""}
            aria-current={view === n.id ? "page" : undefined}
            onClick={() => go(n.id)}
          >
            <n.icon size={32} />
            {n.label}
          </button>
        ))}
      </nav>
      <main className="workspace">
        <MapView
          theme={prefs.theme}
          data={data}
          active={active}
          route={route}
          pickMode={pickMode}
          onPick={(target, p) => {
            if (target === "start") {
              setStart(p);
              setStartValid(true);
            } else {
              setEnd(p);
              setEndValid(true);
            }
            setPickMode(null);
            setView("routes");
            setShowOptions(false);
            setNotice("Map point selected.");
          }}
          onSelect={(f) => {
            setSelected(f);
            if (view !== "map") showMap(view);
          }}
          focus={view === "navigate" ? currentStep : camera}
          visible={view === "map"}
        />
        <section
          id="panel"
          className={
            "panel " +
            (view === "routes" && showOptions ? "focused-panel " : "") +
            (view === "map" ? "map-panel" : "") +
            (view === "navigate" ? " navigation-panel" : "")
          }
          data-loaded={loaded}
          aria-label={
            view === "navigate"
              ? "Navigation"
              : view === "map"
                ? "Map controls"
                : "Luma controls"
          }
        >
          {view === "home" && (
            <HomeView
              theme={prefs.theme}
              end={end}
              lastTrip={lastTrip}
              example={initialEnd}
              plan={(p) => void plan(p)}
              map={() => showMap("home")}
              saved={() => go("saved")}
              where={() => void whereAmI()}
              dictate={dictate}
              listening={listening}
              speak={speak}
            />
          )}
          {view === "saved" && (
            <>
              <header className="page-header">
                <button
                  className="back-button"
                  aria-label="Back home"
                  onClick={() => go("home")}
                >
                  <ArrowLeft />
                </button>
                <h1 tabIndex={-1}>Saved places</h1>
              </header>
              {savedPlaces.length ? (
                savedPlaces.map((p) => (
                  <div className="saved-place" key={p.id}>
                    <button
                      className="outline-button"
                      onClick={() => void plan(p)}
                    >
                      <Star size={28} />
                      {p.name}
                    </button>
                    <button
                      className="icon-button"
                      aria-label={"Remove " + p.name}
                      onClick={() =>
                        setSavedPlaces((s) => s.filter((x) => x.id !== p.id))
                      }
                    >
                      <X />
                    </button>
                  </div>
                ))
              ) : (
                <p>
                  Save a destination from the journey planner to find it here.
                </p>
              )}
            </>
          )}
          {view === "routes" &&
            (showOptions ? (
              <RouteChoices
                routes={routes}
                index={routeIndex}
                setIndex={setRouteIndex}
                busy={busy}
                edit={cancelPlanning}
                map={() => showMap("routes")}
                speak={speak}
                preview={startPreview}
              />
            ) : (
              <JourneyPlanner
                {...prefProps}
                start={start}
                end={end}
                setStart={setStart}
                setEnd={setEnd}
                startValid={startValid}
                endValid={endValid}
                setStartValid={setStartValid}
                setEndValid={setEndValid}
                mode={mode}
                setMode={setMode}
                departure={departure}
                setDeparture={setDeparture}
                timetable={timetable}
                locate={() => void locateStart()}
                map={(target) => {
                  setPickMode(target || null);
                  setSelected(null);
                  showMap("routes");
                }}
                plan={() => void plan()}
                isSaved={savedPlaces.some((p) => p.id === end.id)}
                toggleSaved={() =>
                  setSavedPlaces((places) =>
                    places.some((p) => p.id === end.id)
                      ? places.filter((p) => p.id !== end.id)
                      : [end, ...places],
                  )
                }
              />
            ))}
          {view === "settings" && (
            <Settings {...prefProps} repeatSetup={() => setOnboarding(true)}>
              <ReportHistory />
            </Settings>
          )}
          {view === "navigate" && route && (
            <NavigationView
              route={route}
              step={step}
              prefs={prefs}
              playing={playing}
              togglePlaying={() => {
                setPlaying(!playing);
                if (playing) window.speechSynthesis?.cancel();
              }}
              speak={speak}
              next={() => {
                setPlaying(false);
                setStep((i) => Math.min(route.steps.length - 1, i + 1));
              }}
              end={endPreview}
              where={() => void whereAmI()}
              report={openReport}
              notice={notice}
              pausePreview={() => {
                setPlaying(false);
                window.speechSynthesis?.cancel();
              }}
              reroute={(coordinates) => {
                const origin: Place = {
                  id: "current",
                  name: "Your location",
                  subtitle: "Compass GPS location",
                  coordinates,
                };
                setStart(origin);
                setStartValid(true);
                void plan(undefined, origin);
              }}
            />
          )}
          {view === "report" && (
            <ReportView
              key={reportLocation.id}
              initialLocation={reportLocation}
              back={() => setView(reportReturn)}
              backLabel={
                reportReturn === "navigate"
                  ? "Back to route"
                  : reportReturn === "map"
                    ? "Back to map"
                    : null
              }
              locate={getLocation}
              dictate={dictate}
              listening={listening}
              speak={speak}
            />
          )}
          {view === "map" && (
            <>
              <div className="map-toolbar">
                <button
                  className="outline-button"
                  onClick={() => {
                    setPickMode(null);
                    setView(mapReturn);
                  }}
                >
                  <ArrowLeft />
                  Back
                </button>
                {pickMode && (
                  <p role="status">
                    Tap the map to choose your{" "}
                    {pickMode === "start" ? "start" : "destination"}.
                  </p>
                )}
              </div>
              {selected && selectedPlace ? (
                <div className="feature-card">
                  <button
                    className="icon-button feature-close"
                    aria-label="Close location details"
                    onClick={() => setSelected(null)}
                  >
                    <X />
                  </button>
                  <h1 tabIndex={-1}>{selected.properties.name}</h1>
                  <p>{selected.properties.purpose}</p>
                  <p className="helper">
                    {selected.properties.location_precision}
                  </p>
                  <button
                    className="dark-button"
                    onClick={() => void plan(selectedPlace)}
                  >
                    Directions here
                    <ArrowRight />
                  </button>
                  <button
                    className="outline-button"
                    onClick={() => {
                      setReportLocation({
                        ...selectedPlace,
                        locationSource: "selected",
                      });
                      setReportReturn("map");
                      setView("report");
                    }}
                  >
                    <Flag />
                    Report an issue here
                  </button>
                  <a
                    href={selected.properties.source_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View data source <ExternalLink size={18} />
                  </a>
                </div>
              ) : !pickMode ? (
                <details className="map-filters">
                  <summary>
                    <Layers />
                    Map features
                  </summary>
                  <div>
                    {kinds.map((k) => (
                      <label key={k.id}>
                        <input
                          type="checkbox"
                          checked={active.includes(k.id)}
                          onChange={(e) =>
                            setActive((a) =>
                              e.target.checked
                                ? [...a, k.id]
                                : a.filter((x) => x !== k.id),
                            )
                          }
                        />
                        <k.icon size={24} />
                        {k.name}
                      </label>
                    ))}
                  </div>
                </details>
              ) : null}
            </>
          )}
          {error && (
            <div className="error-card" role="alert">
              <p>{error}</p>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X />
              </button>
            </div>
          )}
        </section>
      </main>
      <div className="sr-only" role="status" aria-live="polite">
        {notice}
      </div>
      </div>
    </>
  );
}
