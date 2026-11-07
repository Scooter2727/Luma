import { useState } from "react";
import CompassPanel from "./compass/CompassPanel";
import {
  ArrowRight,
  Navigation,
  Bus,
  RotateCcw,
  Pause,
  Play,
  LocateFixed,
  ChevronsRight,
  X,
  Flag,
  Volume2,
} from "lucide-react";
import { SignalIcon } from "./Icons";
import type { Coord, Preferences, Route } from "./model";
import { instructionText, timeLabel } from "./model";
type Props = {
  route: Route;
  step: number;
  prefs: Preferences;
  playing: boolean;
  togglePlaying: () => void;
  speak: (text: string) => void;
  next: () => void;
  end: () => void;
  where: () => void;
  report: () => void;
  notice: string;
  pausePreview: () => void;
  reroute: (coordinates: Coord) => void;
};
export default function NavigationView({
  route,
  step,
  prefs,
  playing,
  togglePlaying,
  speak,
  next,
  end,
  where,
  report,
  notice,
  pausePreview,
  reroute,
}: Props) {
  const [compassActive, setCompassActive] = useState(false);
  const s = route.steps[step],
    upcoming = route.steps[step + 1];
  const text = instructionText(s, route.steps[step - 1], prefs.directions);
  const summary =
    prefs.directions === "left-right" ? s.title : text.split(". ")[0];
  const isBus = ["wait", "board", "ride", "alight"].includes(s.kind);
  return (
    <section
      className={"navigation-screen " + (s.crossing ? "crossing-screen" : "")}
      aria-label={s.crossing ? "At the crossing" : "Route preview"}
    >
      <header className="navigation-header">
        <span className="preview-badge">
          Preview · {step + 1}/{route.steps.length}
        </span>
        <button
          className="icon-button"
          aria-label="Report a problem"
          onClick={report}
        >
          <Flag size={25} />
        </button>
      </header>
      <h1 className="sr-only" tabIndex={-1}>
        {s.crossing ? "At the crossing" : "Active navigation preview"}
      </h1>
      {s.crossing ? (
        <>
          <button className="crossing-repeat" onClick={() => speak(text)}>
            <span className="crossing-heading">
              <span className="crossing-label">CROSSING</span>
              <strong>
                {s.street || s.title.replace(/^Cross /, "").split(" at ")[0]}
              </strong>
            </span>
            <span className="crossing-facts">
              <span
                className={
                  "crossing-fact " +
                  (s.control === "ts" || s.audible ? "listed" : "unknown")
                }
              >
                <SignalIcon size={64} />
                <span>
                  {s.control === "ts" || s.audible
                    ? "Signal listed"
                    : "Signal ?"}
                </span>
              </span>
              <span
                className={
                  "crossing-fact " + (s.audible ? "listed" : "unknown")
                }
              >
                <Volume2 size={64} />
                <span>{s.audible ? "Sound listed" : "Sound ?"}</span>
              </span>
            </span>
            <span className="crossing-caution">
              Check traffic and the signal before crossing.
            </span>
            <span className="repeat-label">
              <RotateCcw size={30} />
              Tap anywhere to repeat
            </span>
          </button>
          <p className="helper">Mapped information · no live signal status.</p>
        </>
      ) : (
        <>
          <div className="navigation-instruction">
            {isBus ? (
              <Bus size={56} />
            ) : s.title.toLowerCase().includes("right") ? (
              <ArrowRight size={56} />
            ) : (
              <Navigation size={56} />
            )}
            <div>
              <strong>
                {s.scheduled_time
                  ? timeLabel(s.scheduled_time) + " scheduled"
                  : s.distance > 0
                    ? s.distance + " m"
                    : s.kind === "arrive"
                      ? "Arrival"
                      : "Next instruction"}
              </strong>
              <p>{summary}</p>
            </div>
          </div>
          <div
            className="navigation-controls"
            role="group"
            aria-label="Navigation controls"
          >
            <button className="repeat-control" onClick={() => speak(text)}>
              <RotateCcw size={60} />
              Repeat
            </button>
            <button onClick={togglePlaying} disabled={compassActive}>
              {playing ? <Pause size={60} /> : <Play size={60} />}{" "}
              {playing ? "Pause" : "Play preview"}
            </button>
            <button className="where-control" onClick={where}>
              <LocateFixed size={60} />
              <span>
                Where
                <br />
                am I
              </span>
            </button>
            <button
              onClick={() =>
                speak(
                  upcoming
                    ? "Next: " + instructionText(upcoming, s, prefs.directions)
                    : "This is the last instruction. Confirm the destination entrance.",
                )
              }
            >
              <ChevronsRight size={60} />
              <span>
                What’s
                <br />
                next
              </span>
            </button>
          </div>
        </>
      )}
      <CompassPanel
        route={route}
        screenReader={prefs.screenReader}
        speak={speak}
        reroute={reroute}
        onActivityChange={(active) => {
          setCompassActive(active);
          if (active) pausePreview();
        }}
      />
      <div className="preview-step-actions">
        <button className="text-action" disabled={!upcoming} onClick={next}>
          Next preview step <ArrowRight size={21} />
        </button>
        <span>{route.minutes} min journey</span>
      </div>
      <button className="outline-button end-route" onClick={end}>
        <X size={28} />
        End route
      </button>
      <details className="spoken-details">
        <summary>Instruction text</summary>
        <p>{notice || text}</p>
      </details>
    </section>
  );
}
