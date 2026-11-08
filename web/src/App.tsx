import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useScreenTransition } from "./useScreenTransition";
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
import CompassMode from "./compass/CompassMode";
import { requestCompassAccess } from "./compass/sensors";
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
  aiInstructionText,
  WALKING_SPEED,
} from "./model";
import type { Coord, Feature, Place, Preferences, Route } from "./model";
import {
  aiSpeechAvailable,
  cancelAllSpeech,
  loadSpeechStatus,
  refreshSpeechStatus,
  onAiSpeechChange,
  playAiSpeech,
  prefetchAiSpeech,
  resetAiSpeechSession,
  unlockAiAudio,
} from "./speech";
import { LumaLoader } from "./LumaLoader";
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
    rate: saved("rate", 1),
    screenReader: saved("screenReader", false),
    large: saved("large", false),
    theme: localStorage.getItem("luma-theme") || "default",
    directions: saved<string>("directions-style", "left-right") === "both"
      ? "cardinal"
      : saved("directions-style", "left-right"),
  }));
  const [onboarding, setOnboarding] = useState(
    () => !saved("onboarding-complete", false),
  );
  const [showHero, setShowHero] = useState(true);
  const [askOnHome, setAskOnHome] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const [homeCompass, setHomeCompass] = useState<{
    permission: Promise<string | null>;
    trigger: HTMLElement | null;
  } | null>(null);
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
      mode,
      departure,
    ]);
  const planningKey = keyFor(end),
    currentKey = useRef(planningKey);
  currentKey.current = planningKey;
  const route = routes[routeIndex],
    currentStep = route?.steps[step];
  const change = (values: Partial<Preferences>) => {
    setPrefs((p) => ({ ...p, ...values }));
  };
  const [speechAvailable, setSpeechAvailable] = useState(false),
    [aiVoiceReady, setAiVoiceReady] = useState(aiSpeechAvailable);
  useEffect(() => {
    const unsubscribe = onAiSpeechChange(() =>
      setAiVoiceReady(aiSpeechAvailable()),
    );
    void loadSpeechStatus().then(setSpeechAvailable);
    return unsubscribe;
  }, []);
  const speechTurn = useRef(0);
  function deviceSpeak(text: string) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = prefs.rate;
    window.speechSynthesis.speak(u);
  }
  /** aiText is alternative wording for the AI voice only; the notice and device voice always use text. */
  function speak(text: string, aiText = text) {
    setNotice(text);
    const turn = ++speechTurn.current;
    if (prefs.screenReader) return;
    unlockAiAudio();
    window.speechSynthesis?.cancel();
    void playAiSpeech(aiText, prefs.rate).then((outcome) => {
      if (outcome === "failed" && turn === speechTurn.current)
        deviceSpeak(text);
    });
  }
  function testAiVoice(text: string) {
    setNotice(text);
    if (prefs.screenReader) return;
    const turn = ++speechTurn.current;
    unlockAiAudio();
    window.speechSynthesis?.cancel();
    const runPlay = () =>
      turn === speechTurn.current
        ? playAiSpeech(text, prefs.rate)
        : Promise.resolve("stopped" as const);
    void (aiSpeechAvailable()
      ? runPlay()
      : refreshSpeechStatus().then((available) => {
          setSpeechAvailable(available);
          setAiVoiceReady(aiSpeechAvailable());
          return runPlay();
        })
    ).then((outcome) => {
      if (outcome !== "failed" || turn !== speechTurn.current) return;
      const fallback = "Luma voice is unavailable right now. " + text;
      setNotice(fallback);
      if (!prefs.screenReader) deviceSpeak(fallback);
    });
  }
  useScreenTransition(
    panel,
    `${view}:${showOptions}`,
    !onboarding && !showHero,
    true,
    true,
  );
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
    document.documentElement.classList.toggle("large-text", prefs.large);
    localStorage.setItem("luma-theme", prefs.theme);
    localStorage.removeItem("luma-walking-speed");
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (favicon) {
      favicon.type = "image/svg+xml";
      favicon.href = logoForTheme(prefs.theme);
    }
    for (const [key, value] of Object.entries({
      "audible-v2": prefs.audible,
      "fewer-v2": prefs.fewer,
      "tactile-v2": prefs.tactile,
      rate: prefs.rate,
      screenReader: prefs.screenReader,
      large: prefs.large,
      "directions-style": prefs.directions,
    }))
      localStorage.setItem("luma-" + key, JSON.stringify(value));
    if (prefs.screenReader) cancelAllSpeech();
  }, [prefs]);
  useEffect(() => {
    const chrome = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    const background =
        prefs.theme === "contrast"
          ? "#000000"
          : showHero
            ? prefs.theme === "blue-yellow"
              ? "#f0f0eb"
              : "#ffffff"
            : view === "map" && !onboarding
              ? "#e8ede9"
              : prefs.theme === "blue-yellow"
                ? "#e7e8e2"
                : "#f7f8fc";
    if (chrome) chrome.content = background;
    document.documentElement.style.setProperty("--viewport-background", background);
  }, [prefs.theme, view, showHero, onboarding]);
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
    if (onboarding || showHero) return;
    const id = requestAnimationFrame(() => {
      document.getElementById("panel")?.scrollTo({ top: 0 });
      document.querySelector<HTMLElement>("#panel h1")?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [view, showOptions, showHero, onboarding]);
  // View changes end dictation. Closing the hero does not, so Ask Luma can start it.
  useEffect(() => {
    if (onboarding || showHero) return;
    recognition.current?.stop();
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
      aiInstructionText(route, step, prefs.directions),
    );
    if (currentStep.crossing) setPlaying(false);
  }, [view, step]);
  useEffect(() => {
    if (prefs.screenReader || !aiVoiceReady || !route) return;
    // While choosing, fetch the first two steps so the preview starts instantly; during the
    // preview, fetch only the next step. Re-runs when background rephrasing changes the wording.
    const upcoming =
      view === "navigate"
        ? [step + 1]
        : view === "routes" && showOptions
          ? [0, 1]
          : [];
    for (const i of upcoming)
      if (i < route.steps.length)
        prefetchAiSpeech(aiInstructionText(route, i, prefs.directions));
  }, [
    route,
    step,
    view,
    showOptions,
    prefs.screenReader,
    prefs.directions,
    aiVoiceReady,
  ]);
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
      cancelAllSpeech();
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
      cancelAllSpeech();
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
          walking_speed: WALKING_SPEED,
          mode,
          departure_time: departure || null,
          directions: prefs.directions,
        }),
      });
      if (number !== requestNumber.current || key !== currentKey.current)
        return;
      setRoutes(d.routes);
      setRouteIndex(0);
      setStep(0);
      setNotice(d.routes.length + " route options found.");
      if (!prefs.screenReader && aiSpeechAvailable())
        for (const r of d.routes) void rephraseRoute(r, number);
    } catch (e) {
      if (number === requestNumber.current) setError((e as Error).message);
    } finally {
      if (number === requestNumber.current) setBusy(false);
    }
  }
  /** Replace ai_text with Gemini wording in the background; route planning never waits for it. */
  async function rephraseRoute(r: Route, number: number) {
    try {
      const { texts } = await request<{ texts: string[] }>(
        "/api/speech/rephrase",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            steps: r.steps.map((s) => ({
              text: s.ai_text || s.text,
              street: s.street || null,
              distance: s.distance,
              crossing: s.crossing,
              audible: s.audible ?? null,
              tactile: s.tactile ?? null,
            })),
          }),
        },
      );
      if (number !== requestNumber.current || texts.length !== r.steps.length)
        return;
      setRoutes((current) =>
        current.map((c) =>
          c.id === r.id
            ? {
                ...c,
                steps: c.steps.map((s, i) => ({ ...s, ai_text: texts[i] })),
              }
            : c,
        ),
      );
    } catch {}
  }
  function startPreview() {
    if (!prefs.screenReader) unlockAiAudio();
    setStep(0);
    setPlaying(true);
    setLastTrip(end);
    localStorage.setItem("luma-last-trip", JSON.stringify(end));
    setView("navigate");
  }
  function endPreview() {
    setPlaying(false);
    cancelAllSpeech();
    setView("routes");
    setTimeout(() => document.getElementById("preview-route")?.focus(), 0);
  }
  function completeSetup() {
    localStorage.setItem("luma-onboarding-complete", "true");
    setOnboarding(false);
    setView("home");
  }
  const prefProps = {
    prefs,
    change,
    speak,
    speechAvailable,
    aiVoiceReady,
    testAiVoice,
  };
  const selectedPlace = selected
    ? {
        id: selected.properties.id,
        name: selected.properties.name,
        subtitle: selected.properties.address_or_position,
        coordinates: selected.geometry.coordinates,
      }
    : null;
  return (
    <>
      <AnimatePresence initial={false}>
        {showHero && (
          <Hero
            theme={prefs.theme}
            onTry={() => setShowHero(false)}
            onAsk={() => {
              setAskOnHome(true);
              setShowHero(false);
            }}
          />
        )}
      </AnimatePresence>
      <div
        inert={showHero || !!homeCompass}
        className={
          "app " +
          (onboarding ? "setting-up " : "") +
          (view === "navigate" ? "navigating" : "")
        }
      >
        <a className="skip" href="#panel" hidden={onboarding}>
          Skip map to controls
        </a>
        <nav
          className="main-nav"
          aria-label="Main"
          hidden={
            onboarding ||
            view === "navigate" ||
            (view === "routes" && showOptions)
          }
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
            decorative={onboarding || showHero}
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
          {onboarding ? (
            <div className="setup-shell">
              <Onboarding
                {...prefProps}
                active={!showHero}
                done={completeSetup}
              />
            </div>
          ) : (
            <section
              ref={panel}
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
              {!loaded && !onboarding && (
                <LumaLoader label="Opening Luma…" />
              )}
              {view === "home" && (
                <HomeView
                  theme={prefs.theme}
                  end={end}
                  lastTrip={lastTrip}
                  example={initialEnd}
                  plan={(p) => void plan(p)}
                  map={() => showMap("home")}
                  saved={() => go("saved")}
                  where={() => setHomeCompass({
                    permission: requestCompassAccess(),
                    trigger: document.activeElement as HTMLElement | null,
                  })}
                  dictate={dictate}
                  listening={listening}
                  speak={speak}
                  askOnHome={askOnHome}
                  onAskStarted={() => setAskOnHome(false)}
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
                            setSavedPlaces((s) =>
                              s.filter((x) => x.id !== p.id),
                            )
                          }
                        >
                          <X />
                        </button>
                      </div>
                    ))
                  ) : (
                    <p>
                      Save a destination from the journey planner to find it
                      here.
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
                <Settings
                  {...prefProps}
                  repeatSetup={() => setOnboarding(true)}
                >
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
                    if (playing) cancelAllSpeech();
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
                    cancelAllSpeech();
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
                  theme={prefs.theme}
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
          )}
        </main>
        <div className="sr-only" role="status" aria-live="polite">
          {notice}
        </div>
      </div>
      {homeCompass && (
        <CompassMode
          route={route}
          entry={homeCompass}
          screenReader={prefs.screenReader}
          speak={speak}
          back={() => {
            const trigger = homeCompass.trigger;
            setHomeCompass(null);
            window.speechSynthesis?.cancel();
            requestAnimationFrame(() => trigger?.focus());
          }}
        />
      )}
    </>
  );
}
