import { useRef, useState } from "react";
import {
  Compass,
  Check,
  AlertTriangle,
  HelpCircle,
  ArrowUp,
  Volume2,
} from "lucide-react";
import type { Coord, Route } from "../model";
import { saved } from "../model";
import {
  defaults,
  labels,
  useOrientationTracking,
} from "./useOrientationTracking";
import type { Simulation } from "./useOrientationTracking";

export default function CompassPanel({
  route,
  speak,
  onActivityChange,
  reroute,
  screenReader,
}: {
  route: Route;
  speak: (text: string) => void;
  onActivityChange: (active: boolean) => void;
  reroute: (coordinates: Coord) => void;
  screenReader: boolean;
}) {
  const findButton = useRef<HTMLButtonElement>(null);
  const [enabled, setEnabled] = useState(false),
    [pointing, setPointing] = useState(false);
  const [haptics, setHaptics] = useState(() => saved("compass-haptics", true));
  const [voice, setVoice] = useState(() => saved("compass-voice", true));
  const [config, setConfig] = useState({ ...defaults });
  const [simulation, setSimulation] = useState<Simulation>({
    enabled: false,
    gpsHeading: 90,
    compassHeading: 90,
    expected: 90,
    accuracy: 5,
    speed: 1.2,
    reliableCompass: true,
  });
  const {
    result,
    fix,
    offRoute,
    vibration,
    hapticsAvailable,
    requestCompass,
    testVibration,
  } = useOrientationTracking({
    route,
    enabled,
    pointing,
    simulation,
    haptics,
    voice: voice && !screenReader,
    config,
    speak,
  });
  const uncertain = result.state === "UNCERTAIN";
  const StatusIcon = uncertain
    ? HelpCircle
    : result.state === "ALIGNED"
      ? Check
      : AlertTriangle;
  const pointingText =
    result.state === "ALIGNED"
      ? "Approximate phone alignment only."
      : `Slowly turn the phone ${result.difference !== null && result.difference > 0 ? "left" : "right"} to match the route direction.`;
  function activate(value: boolean) {
    setEnabled(value);
    setPointing(false);
    onActivityChange(value);
  }
  function demo() {
    setSimulation((s) => ({ ...s, enabled: true }));
    activate(true);
    window.requestAnimationFrame(() => findButton.current?.focus());
  }
  function find() {
    setPointing(true);
    // Invoke the browser permission API directly from the button gesture.
    if (!simulation.enabled) void requestCompass();
    if (voice)
      speak(
        (simulation.enabled ? "Demo. " : "") +
          "Stop somewhere safe. Hold your phone flat in portrait, with the top pointing forward. Slowly rotate the phone to find the route direction.",
      );
  }
  const statusText =
    (simulation.enabled ? "Demo. " : "") +
    labels[result.state] +
    ". " +
    (result.reason ||
      (pointing
        ? pointingText + " This does not confirm a clear path."
        : result.state === "ALIGNED"
          ? "Your recent movement follows the mapped walking direction."
          : "Stop somewhere safe and check your direction."));
  return (
    <section className="compass-panel" aria-labelledby="compass-title">
      <div className="compass-heading">
        <h2 id="compass-title" tabIndex={-1}>
          <Compass aria-hidden="true" size={30} /> Luma Compass
        </h2>
        <button
          className="compass-toggle"
          aria-pressed={enabled}
          aria-label={`Luma Compass ${enabled ? "On" : "Off"}`}
          onClick={() => activate(!enabled)}
        >
          {enabled ? "On" : "Off"}
        </button>
      </div>
      {!enabled ? (
        <>
          <p>
            Optional direction feedback using your location. Find your direction
            by pointing your phone.
          </p>
          <button className="text-action" onClick={demo}>
            Try compass demo
          </button>
        </>
      ) : (
        <>
          <p className="compass-mode">
            {simulation.enabled
              ? "DEMO · simulated readings"
              : "LIVE SENSORS · route preview is paused"}
          </p>
          {!hapticsAvailable && (
            <p className="compass-feedback-note">
              Vibration unavailable in this browser. Use voice or screen-reader
              feedback.
            </p>
          )}
          <div
            className="compass-status"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <StatusIcon size={40} aria-hidden="true" />
            <div>
              <strong>{labels[result.state]}</strong>
              <p>
                {result.reason ||
                  (pointing
                    ? pointingText
                    : result.state === "ALIGNED"
                      ? "Your recent movement follows the route direction."
                      : "Stop somewhere safe and check your direction.")}
              </p>
            </div>
          </div>
          {pointing && !uncertain && result.difference !== null && (
            <div className="compass-dial" aria-hidden="true">
              <ArrowUp
                size={88}
                strokeWidth={3}
                style={{ transform: `rotate(${-result.difference}deg)` }}
              />
              <strong>
                {result.state === "ALIGNED"
                  ? "Phone aligned"
                  : `Point phone ${result.difference > 0 ? "left" : "right"}`}
              </strong>
            </div>
          )}
          <button
            ref={findButton}
            className="dark-button compass-find"
            onClick={find}
          >
            <Compass size={32} />
            {pointing ? "Restart direction check" : "Find my direction"}
          </button>
          {pointing && (
            <button
              className="outline-button"
              onClick={() => setPointing(false)}
            >
              Return to movement tracking
            </button>
          )}
          <button className="text-action" onClick={() => speak(statusText)}>
            <Volume2 size={23} aria-hidden="true" />
            Read compass status
          </button>
          <p className="compass-reliability">
            {simulation.enabled
              ? `Simulated GPS accuracy: ${simulation.accuracy} m`
              : fix
                ? `GPS accuracy: approximately ${Math.round(fix.accuracy)} m`
                : "GPS: waiting for a location"}
            <br />
            {uncertain
              ? "Confidence: insufficient for corrections"
              : "Confidence: usable estimate"}
          </p>
          {!simulation.enabled && offRoute && fix && (
            <button
              className="outline-button"
              onClick={() => reroute(fix.coordinates)}
            >
              Recalculate from my location
            </button>
          )}
          <p className="helper">
            Heading does not confirm a clear path or a walk signal. Compass does
            not advance route instructions.
          </p>
          <details className="compass-options">
            <summary>Compass options</summary>
            <label>
              <input
                type="checkbox"
                checked={hapticsAvailable && haptics}
                disabled={!hapticsAvailable}
                aria-describedby="compass-vibration-status"
                onChange={(e) => {
                  setHaptics(e.target.checked);
                  localStorage.setItem(
                    "luma-compass-haptics",
                    JSON.stringify(e.target.checked),
                  );
                }}
              />
              Vibration feedback
            </label>
            <p id="compass-vibration-status">{vibration}</p>
            <button
              className="outline-button"
              onClick={testVibration}
              disabled={!hapticsAvailable}
            >
              Test vibration
            </button>
            <p>
              Two short pulses: possible drift. Three pulses: deviation. One
              long pulse: uncertain. One medium pulse: aligned again.
            </p>
            <label>
              <input
                type="checkbox"
                checked={voice}
                onChange={(e) => {
                  setVoice(e.target.checked);
                  localStorage.setItem(
                    "luma-compass-voice",
                    JSON.stringify(e.target.checked),
                  );
                }}
              />
              Spoken compass feedback
            </label>
            <p>
              Uses your voice speed and screen-reader settings. Sensors stop
              when Compass is off or you leave navigation. Browser sensors may
              pause when the screen locks.
            </p>
          </details>
        </>
      )}
      <details className="compass-options compass-demo">
        <summary>Developer demo</summary>
        <p>Simulated readings only. No location permission is needed.</p>
        <button
          className="outline-button"
          onClick={() => {
            if (simulation.enabled) {
              setSimulation((s) => ({ ...s, enabled: false }));
              activate(false);
            } else demo();
          }}
        >
          {simulation.enabled ? "Exit demo" : "Start compass demo"}
        </button>
        {simulation.enabled && (
          <>
            {(
              [
                ["gpsHeading", "Movement heading", 0, 359, 1],
                ["compassHeading", "Phone heading", 0, 359, 1],
                ["expected", "Route bearing", 0, 359, 1],
                ["accuracy", "GPS accuracy (metres)", 1, 100, 1],
                ["speed", "Walking speed (metres per second)", 0, 3, 0.1],
              ] as const
            ).map(([key, name, min, max, step]) => (
              <label className="compass-slider" key={key}>
                <span>
                  {name}: <strong>{simulation[key]}</strong>
                </span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={simulation[key]}
                  aria-label={name}
                  onChange={(e) =>
                    setSimulation((s) => ({
                      ...s,
                      [key]: Number(e.target.value),
                    }))
                  }
                />
              </label>
            ))}
            <label>
              <input
                type="checkbox"
                checked={simulation.reliableCompass}
                onChange={(e) =>
                  setSimulation((s) => ({
                    ...s,
                    reliableCompass: e.target.checked,
                  }))
                }
              />
              Reliable phone heading
            </label>
            <p>
              Allow a few seconds for sustained changes. Prototype thresholds
              can be adjusted below.
            </p>
            <label>
              Alignment threshold (degrees)
              <input
                aria-label="Alignment threshold"
                type="number"
                min={5}
                max={25}
                value={config.aligned}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    aligned: Math.max(5, Math.min(25, Number(e.target.value))),
                  }))
                }
              />
            </label>
            <label>
              Deviation threshold (degrees)
              <input
                aria-label="Deviation threshold"
                type="number"
                min={30}
                max={70}
                value={config.deviated}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    deviated: Math.max(
                      30,
                      Math.min(70, Number(e.target.value)),
                    ),
                  }))
                }
              />
            </label>
          </>
        )}
      </details>
    </section>
  );
}
